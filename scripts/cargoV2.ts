import { dockToStarbase } from "../actions/dockToStarbase";
import { loadCargo } from "../actions/loadCargo";
import { subwarpToSector } from "../actions/subwarpToSector";
import { undockFromStarbase } from "../actions/undockFromStarbase";
import { unloadCargo } from "../actions/unloadCargo";
import { warpToSector } from "../actions/warpToSector";
import { MAX_AMOUNT, MovementType } from "../common/constants";
import { NotificationMessage } from "../common/notifications";
import { InputResourcesForCargo } from "../common/types";
import { actionWrapper } from "../utils/actions/actionWrapper";
import { sendNotification } from "../utils/actions/sendNotification";
import { BN } from "@staratlas/anchor";
import { ResourceName } from "../src/SageGame";
import { CargoPodType, SageFleet, SectorRoute } from "../src/SageFleet";

export const cargoV2 = async (
  fleet: SageFleet,
  fuelNeeded: number,
  resourcesGo: InputResourcesForCargo[],
  movementGo: MovementType,
  goRoute: SectorRoute[],
  goFuelNeeded: number,
  resourcesBack: InputResourcesForCargo[],
  movementBack: MovementType,
  backRoute: SectorRoute[],
  backFuelNeeded: number,
  useFuelCargo: boolean,
) => {
    const fleetCurrentSector = fleet.getCurrentSector();
    if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

    const fuelTank = fleet.getFuelTank();

    let fuelToLoadGO = 0
    let fuelToLoadBack = 0

    if (new BN(fuelNeeded).gt(fuelTank.maxCapacity)) return { type: "NotEnoughFuelCapacity" as const };

    if(useFuelCargo)
    {
      //Calculate and check if fuel to load is too much
      for (const item of resourcesGo) {
        var cargotype = CargoPodType.CargoHold
        var amount = item.amount
        if(item.resource == ResourceName.Fuel && useFuelCargo)
        {
          if(amount > 0 )
          {        
            fuelToLoadGO = amount
          }
        }
      }

      for (const item of resourcesBack) {
        var cargotype = CargoPodType.CargoHold
        var amount = item.amount
        if(item.resource == ResourceName.Fuel && useFuelCargo)
        {
          if(amount > 0 )
          {        
            fuelToLoadBack = amount
          }
        }
      }

      if (new BN(fuelToLoadBack + fuelToLoadGO + fuelNeeded).gt(fuelTank.maxCapacity)) 
      {
        console.log("Fuel to load is more than available space")
        if(fuelToLoadBack > 0 && fuelToLoadGO > 0)
        {
          return { type: "E da me che voi? Al massimo posso cantarti una canzone" as const };
        }
        else if(fuelToLoadBack > 0)
        {
          fuelToLoadBack = fuelTank.maxCapacity - fuelNeeded
          console.log("Override fuel back load to max capacity %d", fuelToLoadBack)
        }
        else if(fuelToLoadGO > 0)
        {
          fuelToLoadGO = fuelTank.maxCapacity - fuelNeeded
          console.log("Override fuel go load to max capacity %d", fuelToLoadGO)
        }
      }
      else
      {
        console.log("Everything seems ok %d %d", fuelToLoadGO, fuelToLoadBack)
      }
    }

    // 0. Dock to starbase (optional)
    if (
      !fleet.getCurrentState().StarbaseLoadingBay && 
      fleet.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates).type === "Success"
    ) {
      await actionWrapper(dockToStarbase, fleet);
    } else if (
      !fleet.getCurrentState().StarbaseLoadingBay && 
      fleet.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates).type !== "Success"
    ) {
      return fleet.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates);
    }

    // console.log(fuelTank.loadedAmount.toNumber(), fuelNeeded)
    // 1. load fuel
    if (fuelTank.loadedAmount.lt(new BN(fuelNeeded))) {
      await actionWrapper(loadCargo, fleet, ResourceName.Fuel, CargoPodType.FuelTank, new BN(fuelNeeded));
    }

    // 2. load cargo go
    const effectiveResourcesGo: InputResourcesForCargo[] = [];
    var fuelLoaded = 0
    for (const item of resourcesGo) {
      var cargotype = CargoPodType.CargoHold
      var amount = item.amount
      if(item.resource == ResourceName.Ammo)
      {
        if(amount > 0)
        {        
          const loading = await actionWrapper(loadCargo, fleet, item.resource, CargoPodType.AmmoBank, new BN(amount));
          if (loading.type === "Success")
          {  
            effectiveResourcesGo.push(item);
          }
          if(item.amount > fleet.getAmmoBank().maxCapacity)
          {
            const loading2 = await actionWrapper(loadCargo, fleet, item.resource, CargoPodType.CargoHold, new BN(amount - fleet.getAmmoBank().maxCapacity));
            if (loading2.type === "Success")
            {
              effectiveResourcesGo.push(item);
            }  
          }
        }
      }
      else if(item.resource == ResourceName.Fuel && useFuelCargo)
      {
        if(amount > 0 )
        {        
          const loading = await actionWrapper(loadCargo, fleet, item.resource, CargoPodType.FuelTank, new BN(fuelToLoadGO));
          if (loading.type === "Success")
          {  
            effectiveResourcesGo.push(item);
          }
        }
      }
      else
      {
        if(amount > 0)
        {        
          const loading = await actionWrapper(loadCargo, fleet, item.resource, cargotype, new BN(amount));
          if (loading.type === "Success")
            effectiveResourcesGo.push(item);
        }
      }

    }
    
    // 4. undock from starbase
    await actionWrapper(undockFromStarbase, fleet);

    // 5. move to sector (->)
    if (movementGo === MovementType.Warp) {
      for (let i = 1; i < goRoute.length; i++) {
        const sectorTo = goRoute[i];
        const warp = await actionWrapper(warpToSector, fleet, sectorTo, goFuelNeeded,  i < goRoute.length - 1);
        if (warp.type !== "Success") {
            switch (warp.type){
              case "FleetIsDocked":
                await actionWrapper(undockFromStarbase, fleet);
                return warp
                break
            }
        }
      }   
    }

    if (movementGo === MovementType.Mixed) {
      const sectorToInWarp = goRoute[1];
      const warp = await actionWrapper(warpToSector, fleet, sectorToInWarp, goFuelNeeded,  false);
      if (warp.type !== "Success") {
          switch (warp.type){
            case "FleetIsDocked":
              await actionWrapper(undockFromStarbase, fleet);
              return warp
              break
          }
      }
      const sectorToInSub = goRoute[goRoute.length - 1];
      const subwarp = await actionWrapper(subwarpToSector, fleet, sectorToInSub, goFuelNeeded);
    }

    if (movementGo === MovementType.Subwarp) {
      const sectorTo = goRoute[1];
      const subwarp = await actionWrapper(subwarpToSector, fleet, sectorTo, goFuelNeeded);
      if (subwarp.type !== "Success") {
        switch (subwarp.type){
          case "FleetIsDocked":
            await actionWrapper(undockFromStarbase, fleet);
            return subwarp
            break
        }
    }
    }

    // 6. dock to starbase
    const dock1 = await actionWrapper(dockToStarbase, fleet);
    if (dock1.type !== "Success") {
      switch (dock1.type) {
        case "FleetIsDocked":
          break;
        default:
          return dock1;
      }
    }
    
    // 7. unload cargo go
    for (const item of effectiveResourcesGo) {
      var cargotype = CargoPodType.CargoHold
      var amount = new BN(item.amount)
      if(item.resource == ResourceName.Ammo)
      {
        const unloading = await actionWrapper(unloadCargo, fleet, item.resource, CargoPodType.AmmoBank, amount); 
        const unloading2 = await actionWrapper(unloadCargo, fleet, item.resource, CargoPodType.CargoHold, amount); 
      }
      else if(item.resource == ResourceName.Fuel && useFuelCargo)
      { 
          const unloading_hold = await actionWrapper(unloadCargo, fleet, item.resource, CargoPodType.FuelTank, new BN(fuelToLoadGO));
      }
      else
      {
        const unloading = await actionWrapper(unloadCargo, fleet, item.resource, cargotype, amount); 
      }
    }

    
    // 8. load cargo back
    const effectiveResourcesBack: InputResourcesForCargo[] = [];
    
    var fuelLoaded = 0
    for (const item of resourcesBack) {
      var cargotype = CargoPodType.CargoHold
      var amount = item.amount
      if(item.resource == ResourceName.Ammo)
      {
        if(amount > 0)
        {        
          const loading = await actionWrapper(loadCargo, fleet, item.resource, CargoPodType.AmmoBank, new BN(amount));
          if (loading.type === "Success")
          {  
            effectiveResourcesBack.push(item);
          }
          if(item.amount > fleet.getAmmoBank().maxCapacity)
          {
            const loading2 = await actionWrapper(loadCargo, fleet, item.resource, CargoPodType.CargoHold, new BN(amount - fleet.getAmmoBank().maxCapacity));
            if (loading2.type === "Success")
            {
              effectiveResourcesBack.push(item);
            }  
          }
        }
      }
      else if(item.resource == ResourceName.Fuel && useFuelCargo)
      {
        if(amount > 0 )
        {        
          const loading = await actionWrapper(loadCargo, fleet, item.resource, CargoPodType.FuelTank, new BN(fuelToLoadBack));
          if (loading.type === "Success")
          {  
            effectiveResourcesBack.push(item);
          }
        }
      }
      else
      {
        if(amount > 0)
        {  
          const loading = await actionWrapper(loadCargo, fleet, item.resource, cargotype, new BN(amount));
          if (loading.type === "Success")
            effectiveResourcesBack.push(item);
        }
      }

    }

    // 9. undock from starbase
    await actionWrapper(undockFromStarbase, fleet);

    // 10. move to sector (<-)
    if (movementBack === MovementType.Warp) {
      for (let i = 1; i < backRoute.length; i++) {
        const sectorTo = backRoute[i];
        const warp = await actionWrapper(warpToSector, fleet, sectorTo, backFuelNeeded, i < backRoute.length - 1);
        if (warp.type !== "Success") {
          await actionWrapper(dockToStarbase, fleet);
          return warp;
        }
      }   
    }
    
    if (movementBack === MovementType.Mixed) {
      const sectorToInWarp = backRoute[1];
      const warp = await actionWrapper(warpToSector, fleet, sectorToInWarp, backFuelNeeded,  false);
      if (warp.type !== "Success") {
          switch (warp.type){
            case "FleetIsDocked":
              await actionWrapper(undockFromStarbase, fleet);
              return warp
              break
          }
      }
      const sectorToInSub = backRoute[backRoute.length - 1];
      const subwarp = await actionWrapper(subwarpToSector, fleet, sectorToInSub, backFuelNeeded);
    }

    if (movementBack === MovementType.Subwarp) {
      const sectorTo = backRoute[1];
      const subwarp = await actionWrapper(subwarpToSector, fleet, sectorTo, backFuelNeeded);
      if (subwarp.type !== "Success") {
        await actionWrapper(dockToStarbase, fleet);
        return subwarp;
      }
    }

    // 11. dock to starbase
    const dock = await actionWrapper(dockToStarbase, fleet);
    if (dock.type !== "Success") {
      switch (dock.type) {
        case "FleetIsDocked":
          break;
        default:
          return dock;
      }
    }

    // 12. unload cargo back
    for (const item of effectiveResourcesBack) {
      var cargotype = CargoPodType.CargoHold
      var amount = new BN(item.amount)
      if(item.resource == ResourceName.Ammo)
      {
        const unloading = await actionWrapper(unloadCargo, fleet, item.resource, CargoPodType.AmmoBank, amount);  
        const unloading2 = await actionWrapper(unloadCargo, fleet, item.resource, CargoPodType.CargoHold, amount);  
      }
      else if(item.resource == ResourceName.Fuel && useFuelCargo)
      { 
          const unloading_hold = await actionWrapper(unloadCargo, fleet, item.resource, CargoPodType.FuelTank, new BN(fuelToLoadBack));
      }
      else
      {
        const unloading = await actionWrapper(unloadCargo, fleet, item.resource, cargotype, amount);  
      }
    }

    // 13. send notification
    await sendNotification(NotificationMessage.CARGO_SUCCESS, fleet.getName());

    return { type: "Success" as const };
};
