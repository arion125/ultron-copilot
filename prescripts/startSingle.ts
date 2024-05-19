import { undockFromStarbase } from "../actions/undockFromStarbase";
import { dockToStarbase } from "../actions/dockToStarbase";
import { SagePlayer } from "../src/SagePlayer";
import { actionWrapper } from "../utils/actions/actionWrapper";
import { setFleetV2 } from "../utils/inputsV2/setFleet";
import { setSingleActivity } from "../utils/inputsV2/setSingleActivity";
import { startMining } from "./startMining";

export const startSingle = async (player: SagePlayer) => {

  //Set fleet
  const fleet = await setFleetV2(player, true);
  if (fleet.type !== "Success") return fleet;

  //get current sector
  const fleetCurrentSector = fleet.data.getCurrentSector();
  if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

  //Set activity
  const activity = await setSingleActivity();

  switch (activity) {
    case "Undock":
      //undock from starbase
      const undock = await actionWrapper(undockFromStarbase, fleet.data);
      if (undock.type !== "Success") {
          return undock;
      }
    break;
    case "Dock":
      //Dock starbase
      const dock = await actionWrapper(dockToStarbase, fleet.data);
      if (dock.type !== "Success") {
          return dock;
      }
    break;
    case "Start Mining":
      const mining = await startMining(player, true, true);
      if (mining.type !== "Success") {
        console.log("Mining failed.", mining.type)
        return;
      }
      break;
    break;
  }
  
  return { type: "Success" } as const;
}