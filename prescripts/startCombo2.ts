import { SectorCoordinates } from "../common/types";
import { comboV3 } from "../scripts/comboV3";
import { miningV2 } from "../scripts/miningV2";
import { ResourceName } from "../src/SageGame";
import { SagePlayer } from "../src/SagePlayer";
import { setCycles } from "../utils/inputs/setCycles";
import { setFleetV2 } from "../utils/inputsV2/setFleet";
import { setMovementTypeV2 } from "../utils/inputsV2/setMovementType";
import { setResourceToMine } from "../utils/inputsV2/setResourceToMine";
import { setResourcesAmountV2 } from "../utils/inputsV2/setResourcesAmount";
import { setStarbaseV2 } from "../utils/inputsV2/setStarbase";

export const startCombo2 = async (player: SagePlayer) => {
  // 1. set cycles
  const cycles = await setCycles();

  // 2. set fleet
  const fleet = await setFleetV2(player);
  if (fleet.type !== "Success") return fleet;

  const fleetCurrentSector = fleet.data.getCurrentSector();
  if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };


  // 3. set cargo sector
  const starbaseCargo = await setStarbaseV2(fleet.data, true, "Choose the starbase destination for unload:");
  if (starbaseCargo.type !== "Success") return starbaseCargo;

  const sectorCargo = player.getSageGame().getSectorByCoords(starbaseCargo.data.data.sector as SectorCoordinates);
  if (sectorCargo.type !== "Success") return sectorCargo;

  console.log(`Available resource names: ${Object.keys(ResourceName).join(", ")}`);

  // 4. set cargo resource allocation
  const resourcesGo = await setResourcesAmountV2(
    "Enter resources to freight in starbase DESTINATION (e.g., Carbon 5000), or press enter to skip:"
  );

  // 5. set cargo and mining sector
  const starbase = await setStarbaseV2(fleet.data, true, "Choose the starbase destination for mining:");
  if (starbase.type !== "Success") return starbase;

  const sector = player.getSageGame().getSectorByCoords(starbase.data.data.sector as SectorCoordinates);
  if (sector.type !== "Success") return sector;


  // 6. set mining resource
  const resourceToMine = await setResourceToMine(fleet.data, sector.data);
  if (resourceToMine.type !== "Success") return resourceToMine;

  const resourceToMineName = fleet.data.getSageGame().getResourcesMintNameByMint(resourceToMine.data.mineItem.data.mint);
  if (resourceToMineName.type !== "Success") return resourceToMineName;

  // calc fuel, ammo and food needed
  const miningSessionData = fleet.data.getTimeAndNeededResourcesToFullCargoInMining(resourceToMine.data);

  // 6. set fleet movement type (->)
  const movementCargo = await setMovementTypeV2("(-> cargo ->)")

  const [goRouteCargo, goRouteCargoFuelNeeded] = fleet.data.calculateRouteToSector(
    fleetCurrentSector.coordinates as SectorCoordinates, 
    sectorCargo.data.data.coordinates as SectorCoordinates,
    movementCargo?.movement,
  );

// 6. set fleet movement type (->)
const movemenMining = await setMovementTypeV2("(-> mining)")

const [goRouteMining, goRouteMiningFuelNeeded] = fleet.data.calculateRouteToSector(
  sectorCargo.data.data.coordinates as SectorCoordinates, 
  sector.data.data.coordinates as SectorCoordinates,
  movemenMining?.movement,
);

  // 7. set fleet movement type (<-) 
  const movementBack = await setMovementTypeV2("(<-)")
  
  const [backRoute, backFuelNeeded] = fleet.data.calculateRouteToSector(
    sector.data.data.coordinates as SectorCoordinates, 
    fleetCurrentSector.coordinates as SectorCoordinates,
    movementBack?.movement,
  );
  
  const fuelNeeded = miningSessionData.fuelNeeded + (goRouteCargoFuelNeeded + Math.round(goRouteCargoFuelNeeded * 0.3)) +
                                                    (goRouteMiningFuelNeeded + Math.round(goRouteMiningFuelNeeded * 0.3)) +
                                                     (backFuelNeeded + Math.round(backFuelNeeded * 0.3));
  // console.log("Fuel needed:", fuelNeeded);

  // 7. start combo loop
  for (let i = 0; i < cycles; i++) {
    const combo = await comboV3(
      fleet.data,
      resourceToMineName.data,
      fuelNeeded,
      miningSessionData.ammoNeeded,
      miningSessionData.foodNeeded,
      miningSessionData.timeInSeconds,
      resourcesGo,
      movementCargo.movement,
      goRouteCargo,
      goRouteCargoFuelNeeded,
      movemenMining.movement,
      goRouteMining,
      goRouteMiningFuelNeeded,
      movementBack.movement,
      backRoute,
      backFuelNeeded,
    );
    if (combo.type !== "Success") {
      return combo;
    }
  }

  return { type: "Success" } as const;
}