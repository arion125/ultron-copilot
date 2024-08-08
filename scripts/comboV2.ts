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
import { startMining } from "../actions/startMining";
import { stopMining } from "../actions/stopMining";

export const comboV2 = async (
  fleet: SageFleet,
  resourceToMine: ResourceName,
  fuelNeeded: number,
  ammoNeeded: number,
  foodNeeded: number,
  mineTime: number,
  resourcesGo: InputResourcesForCargo[],
  movementGo: MovementType,
  goRoute: SectorRoute[],
  goFuelNeeded: number,
  movementBack: MovementType,
  backRoute: SectorRoute[],
  backFuelNeeded: number,
) => {
  const fleetCurrentSector = fleet.getCurrentSector();
  if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };
  
  const fuelTank = fleet.getFuelTank();

  const ammoBank = fleet.getAmmoBank()

  const cargoHold = fleet.getCargoHold();
  const [foodInCargoData] = cargoHold.resources.filter((item) => item.mint.equals(fleet.getSageGame().getResourcesMint().Food));

  if (new BN(fuelNeeded).gt(fuelTank.maxCapacity)) return { type: "NotEnoughFuelCapacity" as const };

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

  // 1. load fuel
  // console.log(fuelTank.loadedAmount.toNumber(), fuelNeeded)
  if (fuelTank.loadedAmount.lt(new BN(fuelNeeded))) {
    await actionWrapper(loadCargo, fleet, ResourceName.Fuel, CargoPodType.FuelTank, new BN(MAX_AMOUNT));
  }

  // 2. load ammo
  if (ammoBank.loadedAmount.lt(new BN(ammoNeeded))) {
    await actionWrapper(loadCargo, fleet, ResourceName.Ammo, CargoPodType.AmmoBank, new BN(MAX_AMOUNT));
  }

  // 3. load food
  if (foodInCargoData) {
    if (Number(foodInCargoData.amount || 0) < foodNeeded) {
      await actionWrapper(loadCargo, fleet, ResourceName.Food, CargoPodType.CargoHold, new BN(foodNeeded - Number(foodInCargoData.amount || 0)));
    }
  } else {
    await actionWrapper(loadCargo, fleet, ResourceName.Food, CargoPodType.CargoHold, new BN(foodNeeded));
  }

  // 4. load cargo go
  const effectiveResourcesGo: InputResourcesForCargo[] = [];

  for (const item of resourcesGo) {
    const loading = await actionWrapper(loadCargo, fleet, item.resource, CargoPodType.CargoHold, new BN(item.amount));
    if (loading.type === "Success")
      effectiveResourcesGo.push(item);
  }
  
  // 5. undock from starbase
  const undock = await actionWrapper(undockFromStarbase, fleet);
  if (undock.type !== "Success") {
    switch (undock.type) {
      case "FleetIsIdle":
        break;
      case "FleetIsMining":
        await actionWrapper(stopMining, fleet, resourceToMine);
        break;
      case "FleetIsMoving":
        break;
      default:
        return undock;
    }
  }

  // 6. move to sector (->)
  if (movementGo === MovementType.Warp) {
    for (let i = 1; i < goRoute.length; i++) {
      const sectorTo = goRoute[i];
      const warp = await actionWrapper(warpToSector, fleet, sectorTo, goFuelNeeded, i < goRoute.length - 1);
      if (warp.type !== "Success") {
        switch (warp.type) {
          case "FleetIsDocked":
            await actionWrapper(undockFromStarbase, fleet);
            await actionWrapper(warpToSector, fleet, sectorTo, goFuelNeeded, i < goRoute.length - 1);
            break;
          case "FleetIsMining":
            await actionWrapper(stopMining, fleet, resourceToMine);
            await actionWrapper(warpToSector, fleet, sectorTo, goFuelNeeded, i < goRoute.length - 1);
            break;
          default:
            return warp;
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
      switch (subwarp.type) {
        case "FleetIsDocked":
          await actionWrapper(undockFromStarbase, fleet);
          await actionWrapper(subwarpToSector, fleet, sectorTo, goFuelNeeded);
          break;
        case "FleetIsMining":
          await actionWrapper(stopMining, fleet, resourceToMine);
          await actionWrapper(subwarpToSector, fleet, sectorTo, goFuelNeeded);
          break;
        default:
          return subwarp;
      }
    }
  }

  // 7. dock to starbase
  const dock = await actionWrapper(dockToStarbase, fleet);
  if (dock.type !== "Success") {
    switch (dock.type) {
      case "FleetIsMining":
        await actionWrapper(stopMining, fleet, resourceToMine);
        await actionWrapper(dockToStarbase, fleet);
        break;
      case "FleetIsDocked":
        break;
      default:
        return dock;
    }
  }

  // 8. unload cargo go
  for (const item of effectiveResourcesGo) {
    await actionWrapper(unloadCargo, fleet, item.resource, CargoPodType.CargoHold, new BN(item.amount));
  }

  // 9. undock from starbase
  const undock2 = await actionWrapper(undockFromStarbase, fleet);
  if (undock2.type !== "Success") {
    switch (undock2.type) {
      case "FleetIsIdle":
        break;
      case "FleetIsMining":
        await actionWrapper(stopMining, fleet, resourceToMine);
        break;
      case "FleetIsMoving":
        break;
      default:
        return undock;
    }
  }

  // 10. start mining
  const mining = await actionWrapper(startMining, fleet, resourceToMine, mineTime);
  if (mining.type !== "Success") {
    switch (mining.type) {
      case "FleetIsDocked":
        await actionWrapper(undockFromStarbase, fleet);
        await actionWrapper(startMining, fleet, resourceToMine, mineTime);
        break;
      case "FleetIsMining":
        break;
      default:
        return mining;
    }
  }

  // 11. stop mining
  const stop = await actionWrapper(stopMining, fleet, resourceToMine);
  if (stop.type !== "Success") {
    switch (stop.type) {
      case "FleetIsNotMiningAsteroid":
        break;
      default:
        return stop;
    }
  }

  // 12. move to sector (<-)
  if (movementBack === MovementType.Warp) {
    for (let i = 1; i < backRoute.length; i++) {
      const sectorTo = backRoute[i];
      const warp = await actionWrapper(warpToSector, fleet, sectorTo, backFuelNeeded, i < backRoute.length - 1);
      if (warp.type !== "Success") {
        switch (warp.type) {
          case "FleetIsDocked":
            await actionWrapper(undockFromStarbase, fleet);
            await actionWrapper(warpToSector, fleet, sectorTo, backFuelNeeded, i < backRoute.length - 1);
            break;
          case "FleetIsMining":
            await actionWrapper(stopMining, fleet, resourceToMine);
            await actionWrapper(warpToSector, fleet, sectorTo, backFuelNeeded, i < backRoute.length - 1);
            break;
          default:
            return warp;
        }
      }
    }   
  }

  if (movementBack === MovementType.Subwarp) {
    const sectorTo = backRoute[1];
    const subwarp = await actionWrapper(subwarpToSector, fleet, sectorTo, backFuelNeeded);
    if (subwarp.type !== "Success") {
      switch (subwarp.type) {
        case "FleetIsDocked":
          await actionWrapper(undockFromStarbase, fleet);
          await actionWrapper(subwarpToSector, fleet, sectorTo, backFuelNeeded);
          break;
        case "FleetIsMining":
          await actionWrapper(stopMining, fleet, resourceToMine);
          await actionWrapper(subwarpToSector, fleet, sectorTo, backFuelNeeded);
          break;
        default:
          return subwarp;
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

  // 13. dock to starbase
  const dock2 = await actionWrapper(dockToStarbase, fleet);
  if (dock2.type !== "Success") {
    switch (dock2.type) {
      case "FleetIsMining":
        await actionWrapper(stopMining, fleet, resourceToMine);
        await actionWrapper(dockToStarbase, fleet);
        break;
      case "FleetIsDocked":
        break;
      default:
        return dock;
    }
  }

  // 14. unload cargo back
  await actionWrapper(unloadCargo, fleet, resourceToMine, CargoPodType.CargoHold, new BN(MAX_AMOUNT));

  // 15. send notification
  await sendNotification(NotificationMessage.MINING_CARGO_SUCCESS, fleet.getName());

  return { type: "Success" as const };
};
