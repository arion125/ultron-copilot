import { wait } from "../utils/actions/wait";
import { SageFleet, SectorRoute } from "../src/SageFleet";
import { Sector } from "@staratlas/sage";
import { BN } from "@staratlas/anchor";

export const warpToSector = async (
  fleet: SageFleet,
  sector: SectorRoute,
  fuelNeeded: number,
  waitCooldown: boolean
) => {
  // action starts
  console.log(`\nStart warp...`);

  // data
  const fleetCurrentSector = fleet.getCurrentSector();
  if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

  const sectorsDistance = fleet.getSageGame().calculateDistanceByCoords(fleetCurrentSector.coordinates, sector.coordinates);
  const timeToWarp = fleet.calculateWarpTimeWithDistance(sectorsDistance);

  // instruction
  const ix = await fleet.ixWarpToSector(sector, new BN(fuelNeeded));

  // issues and errors handling
  switch (ix.type) {
    // issues that lead to the next action of the main script or the end of the script
    case "NoEnoughFuelToWarp":
      return { type: "NoEnoughFuelToWarp" as const };

    case "FleetIsDocked":
      return { type: "FleetIsDocked" as const };

    case "FleetIsMining":
      return { type: "FleetIsMining" as const };
    
    // blocking errors or failures that require retrying the entire action
    default:
      if (ix.type !== "Success") throw new Error(ix.type); // retry entire action
  }

  // build and send transactions
  const sdt = await fleet.getSageGame().buildAndSendDynamicTransactions(ix.ixs, true);
  if (sdt.type !== "Success") throw new Error(sdt.type); // retry entire action

  // other
  console.log(`Waiting for ${timeToWarp} seconds...`);
  await wait(timeToWarp);
  console.log(`Warp completed!`);
  fleet.updatefleet()

  if (waitCooldown) {
    console.log(`Waiting cooldown for ${fleet.getMovementStats().warpCoolDown} seconds...`);
    await wait(fleet.getMovementStats().warpCoolDown);
    console.log(`Cooldown completed!`);
  }
  else
  {
    //wait 5 seconds to get the fleet position updated
    console.log(`Wait fleet sync`);
    await wait(30);
    console.log(`Fleet sync completed`);
  }

  // action ends
  return { type: "Success" as const }
};
