import { undockFromStarbase } from "../actions/undockFromStarbase";
import { SagePlayer } from "../src/SagePlayer";
import { actionWrapper } from "../utils/actions/actionWrapper";
import { setCycles } from "../utils/inputs/setCycles";
import { setFleetV2 } from "../utils/inputsV2/setFleet";
import { setSingleActivity } from "../utils/inputsV2/setSingleActivity";

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
  }
  
  return { type: "Success" } as const;
}