import { BN } from "@staratlas/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SectorCoordinates } from "../common/types";
import { CargoStats, DepositCargoToFleetInput, Fleet, FleetStateData, IdleToLoadingBayInput, LoadingBayToIdleInput, MovementStats, PlanetType, ScanForSurveyDataUnitsInput, Sector, Ship, ShipStats, StarbaseCreateCargoPodInput, StarbasePlayer, StartMiningAsteroidInput, StartSubwarpInput, StopMiningAsteroidInput, SurveyDataUnitTracker, WarpToCoordinateInput, WithdrawCargoFromFleetInput } from "@staratlas/sage";
import { CargoPod, CargoType } from "@staratlas/cargo";
import { InstructionReturn, byteArrayToString, readAllFromRPC } from "@staratlas/data-source";
import { SagePlayer } from "./SagePlayer";
import { readFromRPCOrError } from "@staratlas/data-source";
import { MinableResource, ResourceName } from "./SageGame";
import { Account, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MAX_AMOUNT, MovementType } from "../common/constants";

/* type CargoPodLoadedResource = {
  cargoType: PublicKey;
  tokenAccount: Account;
  amount: BN;
} */

// !! the best way to reduce error handling is to handle errors at instance creation level
export type LoadedResources = {
    mint: PublicKey;
    amount: BN;
    spaceInCargo: BN;
    cargoTypeKey: PublicKey;
    tokenAccountKey: PublicKey;
}

export type CargoPodEnhanced = {
    key: PublicKey;
    loadedAmount: BN;
    resources: LoadedResources[]; // resource_mint: CargoPodLoadedResource
    maxCapacity: BN;
    fullLoad: boolean;
}

export enum CargoPodType {
    CargoHold = "CargoHold",
    FuelTank = "FuelTank",
    AmmoBank = "AmmoBank",
}

export type SectorRoute = {
  key: PublicKey;
  coordinates: SectorCoordinates;
  hasStarbase: boolean;
}

interface Node {
  x: number;
  y: number;
  cost: number; // Costo totale per raggiungere il nodo
  distance: number; // Distanza euclidea dal nodo di arrivo
  f: number; // Stima del costo totale (cost + distance)
  parent?: Node; // Nodo precedente nel percorso
}

export class SageFleet {

    private fleet!: Fleet;
    private player!: SagePlayer;

    private name: string;
    private key: PublicKey;
    private stats: ShipStats;
    private movementStats: MovementStats;
    private cargoStats: CargoStats;

    private ships!: Ship[];
    private onlyDataRunner: boolean = true;
    private onlyMiners: boolean = true;

    // Dynamic
    private cargoHold!: CargoPodEnhanced;
    private fuelTank!: CargoPodEnhanced;
    private ammoBank!: CargoPodEnhanced;

    // private currentSector!: Sector; // you can get starbase or other data from sector
    private state: FleetStateData;
    
    private constructor(fleet: Fleet, player: SagePlayer) {
        this.fleet = fleet;
        this.player = player;
        this.name = byteArrayToString(fleet.data.fleetLabel);
        this.key = fleet.key;
        this.stats = fleet.data.stats as ShipStats;
        this.movementStats = fleet.data.stats.movementStats as MovementStats;
        this.cargoStats = fleet.data.stats.cargoStats as CargoStats;
        this.state = fleet.state;
    }

    static async init(fleet: Fleet, player: SagePlayer): Promise<SageFleet> {
      const sageFleet = new SageFleet(fleet, player);

      const fuelTank = await sageFleet.getCurrentCargoDataByType(CargoPodType.FuelTank);
      if (fuelTank.type !== "Success") throw new Error(fuelTank.type);

      const ammoBank = await sageFleet.getCurrentCargoDataByType(CargoPodType.AmmoBank);
      if (ammoBank.type !== "Success") throw new Error(ammoBank.type);

      const cargoHold = await sageFleet.getCurrentCargoDataByType(CargoPodType.CargoHold);
      if (cargoHold.type !== "Success") throw new Error(cargoHold.type);

      const [ships] = await Promise.all([
        sageFleet.getShipsAccount()
      ])
      if (ships.type !== "Success") throw new Error(ships.type);

      /* const currentSector = sageFleet.getCurrentSector();
      if (!currentSector) return { type: "FleetCurrentSectorError" as const }; */

      sageFleet.fuelTank = fuelTank.data;
      sageFleet.ammoBank = ammoBank.data;
      sageFleet.cargoHold = cargoHold.data;

      sageFleet.ships = ships.data;
      sageFleet.onlyDataRunner = sageFleet.stats.miscStats.scanCost === 0;
      sageFleet.onlyMiners = sageFleet.stats.cargoStats.ammoConsumptionRate === 0;

      // sageFleet.currentSector = currentSector.data;

      return sageFleet;
    }

    getName() {
      return this.name;
    }

    getKey() {
      return this.key;
    }

    getSageGame() {
        return this.player.getSageGame();
    }

    getPlayer() {
        return this.player;
    }

    getStats() {
        return this.stats;
    }

    getMovementStats() {
        return this.movementStats;
    }

    getCargoStats() {
        return this.cargoStats;
    }

    getShips() {
        return this.ships;
    }

    getOnlyDataRunner() {
        return this.onlyDataRunner;
    }

    getCurrentState() {
      return this.state;
    }

    /** CARGO */
    getFuelTank() {
        return this.fuelTank;
    }

    getAmmoBank() {
        return this.ammoBank;
    }

    getCargoHold() {
        return this.cargoHold;
    }

    /* getResourceInCargoHoldByName(resourceName: ResourceName) {
        return this.cargoHold.loadedResources.filter((item) => item.mint.equals(this.getSageGame().getResourceMintByName(resourceName)))[0];
    } */
    /** END CARGO */

    private async getShipsAccount() {
      try {
        const fetchShips = await readAllFromRPC(
          this.getSageGame().getProvider().connection,
          this.getSageGame().getSageProgram(),
          Ship,
          "confirmed"
        );

        const ships = fetchShips.flatMap((ship) =>
        ship.type === "ok" ? [ship.data] : []
        );

        if (ships.length === 0) throw new Error();

        return { type: "Success" as const, data: ships };
      } catch (e) {
        return { type: "ShipsNotFound" as const };
      }
    }

    updatefleet(){
      this.update()
    }

    // !! this function throws an error
    getCurrentSector(): SectorRoute {  
      let coordinates;
      let starbase;
  
      if (this.fleet.state.MoveWarp) {
        coordinates = this.fleet.state.MoveWarp.toSector as SectorCoordinates;
        starbase = this.getSageGame().getStarbaseByCoords(coordinates);
        return { key: this.getSageGame().getSectorKeyByCoords(coordinates), coordinates, hasStarbase: starbase.type === "Success" };
      }
  
      if (this.fleet.state.MoveSubwarp) {
        coordinates = this.fleet.state.MoveSubwarp.toSector as SectorCoordinates;
        starbase = this.getSageGame().getStarbaseByCoords(coordinates);
        return { key: this.getSageGame().getSectorKeyByCoords(coordinates), coordinates, hasStarbase: starbase.type === "Success" };
      }
    
      if (this.fleet.state.StarbaseLoadingBay) {
        const starbase = this.getSageGame().getStarbaseByKey(this.fleet.state.StarbaseLoadingBay.starbase);
        if (starbase.type !== "Success") {
          throw new Error("Starbase loading failed");
        }
        coordinates = starbase.data.data.sector as SectorCoordinates;
        return { key: this.getSageGame().getSectorKeyByCoords(coordinates), coordinates, hasStarbase: true };
      }
    
      if (this.fleet.state.Idle) {
        coordinates = this.fleet.state.Idle.sector as SectorCoordinates;
        starbase = this.getSageGame().getStarbaseByCoords(coordinates);
        return { key: this.getSageGame().getSectorKeyByCoords(coordinates), coordinates, hasStarbase: starbase.type === "Success" };
      }
    
      if (this.fleet.state.Respawn) {
        coordinates = this.fleet.state.Respawn.sector as SectorCoordinates;
        starbase = this.getSageGame().getStarbaseByCoords(coordinates);
        return { key: this.getSageGame().getSectorKeyByCoords(coordinates), coordinates, hasStarbase: starbase.type === "Success" };
      }
  
      if (this.fleet.state.MineAsteroid) {
        const planet = this.getSageGame().getPlanetByKey(this.fleet.state.MineAsteroid.asteroid);
        if (planet.type !== "Success") {
          throw new Error("Planet loading failed");
        }
        coordinates = planet.data.data.sector as SectorCoordinates;
        starbase = this.getSageGame().getStarbaseByCoords(coordinates);
        return { key: this.getSageGame().getSectorKeyByCoords(coordinates), coordinates, hasStarbase: starbase.type === "Success" };
      }
    
      throw new Error("Invalid fleet state");
    };

    private async getCurrentCargoDataByType(type: CargoPodType) {
      const cargoPodType = 
        type === CargoPodType.CargoHold ? this.fleet.data.cargoHold :
        type === CargoPodType.FuelTank ? this.fleet.data.fuelTank :
        type === CargoPodType.AmmoBank ? this.fleet.data.ammoBank :
        null;

      const cargoPodMaxCapacity: BN = 
        type === CargoPodType.CargoHold ? new BN(this.cargoStats.cargoCapacity) :
        type === CargoPodType.FuelTank ? new BN(this.cargoStats.fuelCapacity) :
        type === CargoPodType.AmmoBank ? new BN(this.cargoStats.ammoCapacity) :
        new BN(0);

      if (!cargoPodType || cargoPodMaxCapacity.eq(new BN(0))) return { type: "CargoPodTypeError" as const };

      const cargoPod = await this.getCargoPodByKey(cargoPodType);
      if (cargoPod.type !== "Success") return cargoPod;

      const cargoPodTokenAccounts = await this.getSageGame().getParsedTokenAccountsByOwner(cargoPod.data.key);

      if (cargoPodTokenAccounts.type !== "Success" || cargoPodTokenAccounts.data.length == 0) { 
        const cpe: CargoPodEnhanced = {
          key: cargoPod.data.key,
          loadedAmount: new BN(0),
          resources: [],
          maxCapacity: cargoPodMaxCapacity,
          fullLoad: false,
        }
        return { 
          type: "Success" as const,
          data: cpe
        };
      }

      const resources: LoadedResources[] = [];

      for (const cargoPodTokenAccount of cargoPodTokenAccounts.data) {
          const cargoType = await this.getSageGame().getCargoTypeByMintAsync(cargoPodTokenAccount.mint);
          if (cargoType.type !== "Success") return cargoType;

          const resourceSpaceInCargoPerUnit = cargoType.data.stats[0] as BN;

          resources.push({ 
            mint: cargoPodTokenAccount.mint,
            amount: new BN(cargoPodTokenAccount.amount),
            spaceInCargo: new BN(cargoPodTokenAccount.amount).mul(resourceSpaceInCargoPerUnit),
            cargoTypeKey: cargoType.data.key,
            tokenAccountKey: cargoPodTokenAccount.address,
          });
      }

      let loadedAmount = new BN(0);
      resources.forEach((item) => {
          loadedAmount = loadedAmount.add(item.spaceInCargo);
      });
      
      const cpe: CargoPodEnhanced = {
        key: cargoPod.data.key,
        loadedAmount,
        resources,
        maxCapacity: cargoPodMaxCapacity,
        fullLoad: loadedAmount.eq(cargoPodMaxCapacity),
      }

      return { 
        type: "Success" as const, 
        data: cpe
      };
    }

    private async getCargoPodByKey(cargoPodKey: PublicKey) {
      try {
        const cargoPodAccount = await readFromRPCOrError(
          this.getSageGame().getProvider().connection,
          this.getSageGame().getCargoProgram(),
          cargoPodKey,
          CargoPod,
          "confirmed"
        );
        return { type: "Success" as const, data: cargoPodAccount };
      } catch (e) {
        return { type: "CargoPodNotFound" as const };
      }
    }

    private async update() {
        await this.getSageGame().delay(5000); // wait five seconds before updating the fleet

        const fleet = await this.player.getFleetByKeyAsync(this.fleet.key);
        if (fleet.type !== "Success") return fleet;

        const fuelTank = await this.getCurrentCargoDataByType(CargoPodType.FuelTank);
        if (fuelTank.type !== "Success") return fuelTank;

        const ammoBank = await this.getCurrentCargoDataByType(CargoPodType.AmmoBank);
        if (ammoBank.type !== "Success") return ammoBank;

        const cargoHold = await this.getCurrentCargoDataByType(CargoPodType.CargoHold);
        if (cargoHold.type !== "Success") return cargoHold;

        /* const currentSector = await this.getCurrentSectorAsync();
        if (currentSector.type !== "Success") return currentSector; // throw new Error(currentSector.type); ? */

        this.fleet = fleet.data;
        this.state = fleet.data.state;

        this.fuelTank = fuelTank.data;
        this.ammoBank = ammoBank.data;
        this.cargoHold = cargoHold.data;
        // this.currentSector = currentSector.data;

        return { type: "Success" as const };
    }

    /** HELPERS */
    private getTimeToWarpByCoords(coordinatesFrom: [BN, BN], coordinatesTo: [BN, BN]) {
      const timeToWarp = Fleet.calculateWarpTimeWithCoords(
        this.stats,
        coordinatesFrom,
        coordinatesTo
      );

      return timeToWarp;
    }

    getTimeToWarpBySector(sectorFrom: Sector, sectorTo: Sector) {
      const timeToWarp = Fleet.calculateWarpTimeWithCoords(
        this.stats,
        sectorFrom.data.coordinates as [BN, BN],
        sectorTo.data.coordinates as [BN, BN]
      );

      return timeToWarp;
    }

    private getTimeToSubwarpByCoords(coordinatesFrom: [BN, BN], coordinatesTo: [BN, BN]) {
      const timeToSubwarp = Fleet.calculateSubwarpTimeWithCoords(
        this.stats,
        coordinatesFrom,
        coordinatesTo
      );

      return timeToSubwarp;
    }

    getTimeToSubwarpBySector(sectorFrom: Sector, sectorTo: Sector) {
      const timeToSubwarp = Fleet.calculateSubwarpTimeWithCoords(
        this.stats,
        sectorFrom.data.coordinates as [BN, BN],
        sectorTo.data.coordinates as [BN, BN]
      );

      return timeToSubwarp;
    }

    getTimeAndNeededResourcesToFullCargoInMining(minableResource: MinableResource) {
      const timeInSeconds = Fleet.calculateAsteroidMiningResourceExtractionDuration(
        this.stats,
        minableResource.mineItem.data,
        minableResource.resource.data,
        this.cargoStats.cargoCapacity
      );

      const foodNeeded = Math.ceil(
        Fleet.calculateAsteroidMiningFoodToConsume(
          this.stats,
          MAX_AMOUNT,
          timeInSeconds
        )
      );

      const ammoNeeded = Math.ceil(
        Fleet.calculateAsteroidMiningAmmoToConsume(
          this.stats,
          MAX_AMOUNT,
          timeInSeconds
        )
      );

      const fuelNeeded = this.movementStats.planetExitFuelAmount;

      return { foodNeeded, ammoNeeded, fuelNeeded, timeInSeconds };
    }

    calculateSubwarpFuelBurnWithDistance(distance: number) {
      return Fleet.calculateSubwarpFuelBurnWithDistance(this.stats, distance);
    }

    calculateWarpFuelBurnWithDistance(distance: number) {
      return Fleet.calculateWarpFuelBurnWithDistance(this.stats, distance);
    }

    calculateWarpTimeWithDistance(distance: number) {
      return Fleet.calculateWarpTime(this.stats, distance);
    }

    calculateSubwarpTimeWithDistance(distance: number) {
      return Fleet.calculateSubwarpTime(this.stats, distance);
    }

    calculateRouteToSector(sectorFrom: SectorCoordinates, sectorTo: SectorCoordinates, movement?: MovementType): [SectorRoute[], number] {
      if (sectorFrom[0].eq(sectorTo[0]) && sectorFrom[1].eq(sectorTo[1])) return [[], 0]

      const route = 
        movement === MovementType.Warp ? 
          this.createWarpRoute(sectorFrom, sectorTo) :
          movement === MovementType.Subwarp ?
          [
            {
            key: this.getSageGame().getSectorKeyByCoords(sectorFrom),
            coordinates: sectorFrom,
            hasStarbase: this.getSageGame().getStarbaseByCoords(sectorFrom).type === "Success"
            }, 
            {
              key: this.getSageGame().getSectorKeyByCoords(sectorTo),
              coordinates: sectorTo,
              hasStarbase: this.getSageGame().getStarbaseByCoords(sectorTo).type === "Success"
            }
          ] : [];

      if (route.length === 0) return [route, 0];

      const fuelNeeded = movement === MovementType.Warp ? 
        (() => { // WARP
          return route.reduce((fuelNeeded, currentSector, i, sectors) => {
            if (i === sectors.length - 1) return fuelNeeded;
            const nextSector = sectors[i + 1];
            const sectorsDistanceGo = this.getSageGame().calculateDistanceByCoords(currentSector.coordinates, nextSector.coordinates);
            return fuelNeeded + this.calculateWarpFuelBurnWithDistance(sectorsDistanceGo);
          }, 0)
        })() : movement === MovementType.Subwarp ? 
        (() => { // SUBWARP
          const sectorsDistanceGo = this.getSageGame().calculateDistanceByCoords(route[0].coordinates, route[1].coordinates);
          return this.calculateSubwarpFuelBurnWithDistance(sectorsDistanceGo);
        })() : 0;

      return [route, fuelNeeded];
    }
    /** END HELPERS */


    /** MOVEMENTS ROUTE */
    private createWarpRoute(sectorFrom: SectorCoordinates, sectorTo: SectorCoordinates) { 
      const start: Node = {x: sectorFrom[0].toNumber(), y: sectorFrom[1].toNumber(), cost: 0, distance: 0, f: 0};
      const goal: Node = {x: sectorTo[0].toNumber(), y: sectorTo[1].toNumber(), cost: 0, distance: 0, f: 0};
      
      const criticalPoints = this.aStarPathfindingWithRestStops(start, goal, this.getMovementStats().maxWarpDistance / 100);
  
      const sectorRoute: SectorRoute[] = [];
      for (const node of criticalPoints) {
        const sectorKey = this.getSageGame().getSectorKeyByCoords([new BN(node.x), new BN(node.y)]);
        sectorRoute.push({
          key: sectorKey,
          coordinates: [new BN(node.x), new BN(node.y)],
          hasStarbase: this.getSageGame().getStarbaseByCoords([new BN(node.x), new BN(node.y)]).type === "Success"
        });
      }
      if (criticalPoints.length !== sectorRoute.length) return [];

      return sectorRoute;
    };
      
    // Calcola la distanza euclidea tra due nodi
    private euclideanDistance(a: Node, b: Node): number {
        return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    }
      
    // Ricostruisce il percorso partendo dal nodo di arrivo
    private reconstructPath(endNode: Node): Node[] {
        const path: Node[] = [];
        let currentNode: Node | undefined = endNode;
        while (currentNode) {
            path.unshift(currentNode);
            if (!currentNode.parent) break;
            currentNode = currentNode.parent;
        }
        return path;
    }
      
    // Determina i punti di sosta lungo il percorso
    private identifyRestStops(path: Node[], maxDistancePerSegment: number): Node[] {
        if (path.length === 0) return [];
    
        const restStops: Node[] = [path[0]]; // Partenza sempre inclusa
        let lastRestStop = path[0];
    
        for (let i = 1; i < path.length; i++) {
            const segmentDistance = this.euclideanDistance(path[i], lastRestStop);
    
            if (segmentDistance > maxDistancePerSegment) {
            // Se la distanza dall'ultima sosta supera il massimo consentito, 
            // aggiungi l'ultimo nodo visitato prima di superare il limite come punto di sosta
            if(i > 1) { // Assicura di non aggiungere il punto di partenza due volte
                restStops.push(path[i - 1]);
                lastRestStop = path[i - 1]; // Aggiorna l'ultima sosta
            }
    
            // Dopo l'aggiunta del punto di sosta, verifica anche se il punto corrente deve essere una sosta
            // Ciò può accadere se la distanza dal punto di sosta appena aggiunto al punto corrente supera maxDistancePerSegment
            if (this.euclideanDistance(path[i], lastRestStop) > maxDistancePerSegment) {
                restStops.push(path[i]);
                lastRestStop = path[i]; // Aggiorna l'ultima sosta
            }
            }
        }
    
        // Assicura che il punto di arrivo sia sempre incluso come ultima sosta se non già presente
        if (!restStops.includes(path[path.length - 1])) {
            restStops.push(path[path.length - 1]);
        }
    
        return restStops;
    }
      
    // Implementazione dell'algoritmo A* con la logica per i punti di sosta
    private aStarPathfindingWithRestStops(start: Node, goal: Node, maxDistancePerSegment: number): Node[] {
        const openSet: Node[] = [start];
        const closedSet: Node[] = [];
        start.distance = this.euclideanDistance(start, goal);
        start.f = start.distance;
    
        while (openSet.length > 0) {
            let current = openSet.reduce((prev, curr) => prev.f < curr.f ? prev : curr);
    
            if (current.x === goal.x && current.y === goal.y) {
            const path = this.reconstructPath(current);
            return this.identifyRestStops(path, maxDistancePerSegment);
            }
    
            openSet.splice(openSet.indexOf(current), 1);
            closedSet.push(current);
    
            for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue; // Salta il nodo corrente
                const neighborX = current.x + dx;
                const neighborY = current.y + dy;
    
                // Verifica se il vicino è già stato esaminato
                if (closedSet.some(node => node.x === neighborX && node.y === neighborY)) continue;
    
                const tentativeGScore = current.cost + this.euclideanDistance(current, {x: neighborX, y: neighborY, cost: 0, distance: 0, f: 0});
    
                let neighbor = openSet.find(node => node.x === neighborX && node.y === neighborY);
                if (!neighbor) {
                neighbor = {x: neighborX, y: neighborY, cost: Infinity, distance: 0, f: 0};
                openSet.push(neighbor);
                }
    
                if (tentativeGScore >= neighbor.cost) continue; // Questo non è un percorso migliore
    
                // Questo percorso è il migliore finora. Memorizzalo!
                neighbor.parent = current;
                neighbor.cost = tentativeGScore;
                neighbor.distance = this.euclideanDistance(neighbor, goal);
                neighbor.f = neighbor.cost + neighbor.distance;
            }
            }
        }
    
        return []; // Nessun percorso trovato
    }
    /** END MOVEMENTS ROUTE */


    /** SAGE INSTRUCTIONS */

    /** CARGO */
    async ixLoadCargo(resourceName: ResourceName, cargoPodType: CargoPodType, amount: BN) {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      if (!this.state.StarbaseLoadingBay) return { type: "FleetNotDockedToStarbase" as const };

      const ixs: InstructionReturn[] = [];
      const mint = this.getSageGame().getResourceMintByName(resourceName);

      const cargoType = await this.getSageGame().getCargoTypeByMintAsync(mint);
      if (cargoType.type !== "Success") return cargoType;

      const resourceSpaceInCargoPerUnit = cargoType.data.stats[0] as BN;

      const fleetCurrentSector = this.getCurrentSector();
      if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

      const currentStarbase = this.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates);
      if (currentStarbase.type !== "Success") return currentStarbase;

      const starbasePlayerPod = await this.player.getStarbasePlayerPodAsync(currentStarbase.data);
      if (starbasePlayerPod.type !== "Success") return starbasePlayerPod; 
      // console.log(starbasePlayerPod)

      const starbasePodMintAta = this.getSageGame().getAssociatedTokenAddressSync(starbasePlayerPod.data.key, mint)
      const starbasePodMintAtaBalance = await this.getSageGame().getTokenAccountBalance(starbasePodMintAta);
      // console.log(starbasePodMintAtaBalance)

      const cargoHold = await this.getCurrentCargoDataByType(cargoPodType);
      if (cargoHold.type !== "Success") return cargoHold;

      const ixFleetCargoHoldMintAta = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(cargoHold.data.key, mint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixFleetCargoHoldMintAta.address);
      } catch (e) {
        ixs.push(ixFleetCargoHoldMintAta.instruction);
      }
      // console.log(ixFleetCargoPodMintAta)

      // Calc the amount to deposit
      let amountToDeposit = BN.min(
        amount.mul(resourceSpaceInCargoPerUnit),
        cargoHold.data.loadedAmount.gt(new BN(0))
          ? cargoHold.data.maxCapacity.sub(
              cargoHold.data.loadedAmount
            )
          : cargoHold.data.maxCapacity
      );
      // console.log(cargoHold.data.loadedAmount.toNumber())
      amountToDeposit = amountToDeposit.div(resourceSpaceInCargoPerUnit)
      // console.log(amountToDeposit.toNumber())
      if (amountToDeposit.eq(new BN(0))) return { type: "FleetCargoPodIsFull" as const };
      amountToDeposit = BN.min(amountToDeposit, new BN(starbasePodMintAtaBalance));
      if (amountToDeposit.eq(new BN(0))) return { type: "StarbaseCargoIsEmpty" as const };

      // console.log(amountToDeposit.toNumber())

      const input: DepositCargoToFleetInput = { keyIndex: 0, amount: amountToDeposit }

      const ix_1 = Fleet.depositCargoToFleet(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getCargoProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        "funder",
        currentStarbase.data.key,
        this.player.getStarbasePlayerAddress(currentStarbase.data),
        this.fleet.key,
        starbasePlayerPod.data.key,
        cargoHold.data.key,
        this.getSageGame().getCargoTypeKeyByMint(mint),
        this.getSageGame().getCargoStatsDefinition().key,
        starbasePodMintAta,
        ixFleetCargoHoldMintAta.address,
        mint,
        this.getSageGame().getGame().key,
        this.getSageGame().getGameState().key,
        input
      )

      ixs.push(ix_1);
      return { type: "Success" as const, ixs, amountToDeposit };
    }

    async ixUnloadCargo(resourceName: ResourceName, cargoPodType: CargoPodType, amount: BN) {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      if (!this.state.StarbaseLoadingBay) return { type: "FleetNotDockedToStarbase" as const };

      const ixs: InstructionReturn[] = [];
      const mint = this.getSageGame().getResourceMintByName(resourceName);

      const fleetCurrentSector = this.getCurrentSector();
      if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

      const currentStarbase = this.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates);
      if (currentStarbase.type !== "Success") return currentStarbase;

      const starbasePlayerPod = await this.player.getStarbasePlayerPodAsync(currentStarbase.data);
      if (starbasePlayerPod.type !== "Success") return starbasePlayerPod; 
      // console.log(starbasePlayerPod)

      const ixStarbasePodMintAta = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(starbasePlayerPod.data.key, mint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixStarbasePodMintAta.address);
      } catch (e) {
        ixs.push(ixStarbasePodMintAta.instruction);
      }

      const cargoPod = await this.getCurrentCargoDataByType(cargoPodType);
      if (cargoPod.type !== "Success") return cargoPod;
      // console.log(cargoHold)

      const [fleetCargoPodResourceData] = cargoPod.data.resources.filter((item) => item.mint.equals(mint));
      if (!fleetCargoPodResourceData) return { type: "NoResourcesToWithdraw" as const };
      // console.log(mintAta)

      // Calc the amount to withdraw
      let amountToWithdraw = BN.min(amount, new BN(fleetCargoPodResourceData.amount));
      if (amountToWithdraw.eq(new BN(0))) return { type: "NoResourcesToWithdraw" as const };

      // console.log(amountToWithdraw.toNumber())

      const input: WithdrawCargoFromFleetInput = { keyIndex: 0, amount: amountToWithdraw }

      const ix_1 = Fleet.withdrawCargoFromFleet(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getCargoProgram(),
        this.getSageGame().getAsyncSigner(),
        "funder",
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        currentStarbase.data.key,
        this.player.getStarbasePlayerAddress(currentStarbase.data),
        this.fleet.key,
        cargoPod.data.key,
        starbasePlayerPod.data.key,
        this.getSageGame().getCargoTypeKeyByMint(mint),
        this.getSageGame().getCargoStatsDefinition().key,
        fleetCargoPodResourceData.tokenAccountKey,
        ixStarbasePodMintAta.address,
        mint,
        this.getSageGame().getGame().key,
        this.getSageGame().getGameState().key,
        input
      )

      ixs.push(ix_1);
      return { type: "Success" as const, ixs, amountToWithdraw };
    }
    /** END CARGO */

    /** MINING */
    async ixStartMining(resourceName: ResourceName) {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      if (this.state.MineAsteroid) return { type: "FleetIsMining" as const };
      if (this.state.StarbaseLoadingBay) return { type: "FleetIsDocked" as const };

      const ixs: InstructionReturn[] = [];

      const fleetCurrentSector = this.getCurrentSector();
      if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

      const currentStarbase = this.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates);
      if (currentStarbase.type !== "Success") return currentStarbase;

      const starbasePlayerKey = this.player.getStarbasePlayerAddress(currentStarbase.data);
      const starbasePlayer = await this.player.getStarbasePlayerByStarbaseAsync(currentStarbase.data);
      if (starbasePlayer.type !== "Success") {
        const ix_0 = StarbasePlayer.registerStarbasePlayer(
          this.getSageGame().getSageProgram(),
          this.player.getProfileFactionAddress(),
          this.player.getSagePlayerProfileAddress(),
          currentStarbase.data.key,
          this.getSageGame().getGame().key,
          this.getSageGame().getGameState().key,
          currentStarbase.data.data.seqId
        );
        ixs.push(ix_0);
      }
      //console.log(fleetCurrentSector.coordinates)
      const currentPlanet = this.getSageGame().getPlanetsByCoords(fleetCurrentSector.coordinates, PlanetType.AsteroidBelt);
      if (currentPlanet.type !== "Success") return currentPlanet;
      //console.log(currentPlanet)
      const mineableResource = this.getSageGame().getMineItemAndResourceByNameAndPlanetKey(resourceName, currentPlanet.data[0].key);
      //console.log(mineableResource)
      const fuelTank = this.getFuelTank()

      const [fuelInTankData] = fuelTank.resources.filter((item) => item.mint.equals(this.getSageGame().getResourcesMint().Fuel));
      if (!fuelInTankData) return { type: "FleetCargoPodTokenAccountNotFound" as const };

      const input: StartMiningAsteroidInput = { keyIndex: 0 };

      // Movement Handler
      const ix_movement = await this.ixMovementHandler();
      if (ix_movement.type !== "Success") return ix_movement;
      if (ix_movement.ixs.length > 0) ixs.push(...ix_movement.ixs);

      const ix_1 = Fleet.startMiningAsteroid(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        this.fleet.key,
        currentStarbase.data.key,
        starbasePlayerKey,
        mineableResource.mineItem.key,
        mineableResource.resource.key,
        currentPlanet.data[0].key,
        this.getSageGame().getGameState().key,
        this.getSageGame().getGame().key,
        fuelInTankData.tokenAccountKey,
        input
      );
      ixs.push(ix_1);
  
      return { type: "Success" as const, ixs };
    }

    // FIX: I often get the 6087 (InvalidTime) error when trying to stop mining. Why?
    async ixStopMining() {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      if (!this.fleet.state.MineAsteroid) return { type: "FleetIsNotMiningAsteroid" as const };

      const ixs: InstructionReturn[] = [];

      const fleetCurrentSector = this.getCurrentSector();
      if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

      const currentStarbase = this.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates);
      if (currentStarbase.type !== "Success") return currentStarbase;
      
      const planetKey = this.fleet.state.MineAsteroid.asteroid;
      const miningResourceKey = this.fleet.state.MineAsteroid.resource

      const miningResource = this.getSageGame().getResourceByKey(miningResourceKey);
      if (miningResource.type !== "Success") return miningResource;

      const miningMineItem = this.getSageGame().getMineItemByKey(miningResource.data.data.mineItem)
      if (miningMineItem.type !== "Success") return miningMineItem;

      const miningMint = miningMineItem.data.data.mint
      const foodMint = this.getSageGame().getResourcesMint().Food
      const ammoMint = this.getSageGame().getResourcesMint().Ammo
      const fuelMint = this.getSageGame().getResourcesMint().Fuel

      const cargoHold = this.getCargoHold();

      const ixFleetCargoHoldMintAta = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(cargoHold.key, miningMint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixFleetCargoHoldMintAta.address);
      } catch (e) {
        ixs.push(ixFleetCargoHoldMintAta.instruction);
      }

      const ixFleetCargoHoldFoodAta = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(cargoHold.key, foodMint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixFleetCargoHoldFoodAta.address);
      } catch (e) {
        ixs.push(ixFleetCargoHoldFoodAta.instruction);
      }

      const ammoBank = this.getAmmoBank();

      const ixFleetAmmoBankAmmoAta = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(ammoBank.key, ammoMint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixFleetAmmoBankAmmoAta.address);
      } catch (e) {
        if (!this.onlyMiners) {
          ixs.push(ixFleetAmmoBankAmmoAta.instruction);
        }
      }

      const fuelTank = this.getFuelTank();

      const ixFleetFuelTankFuelAta = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(fuelTank.key, fuelMint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixFleetFuelTankFuelAta.address);
      } catch (e) {
        ixs.push(ixFleetFuelTankFuelAta.instruction);
      }

      const miningResourceFrom = getAssociatedTokenAddressSync(miningMint, miningMineItem.data.key, true);

      const ix_0 = Fleet.asteroidMiningHandler(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getCargoProgram(),
        this.fleet.key,
        currentStarbase.data.key,
        miningMineItem.data.key,
        miningResource.data.key,
        planetKey,
        this.fleet.data.cargoHold,
        this.fleet.data.ammoBank,
        this.getSageGame().getCargoTypeByResourceName(ResourceName.Food),
        this.getSageGame().getCargoTypeByResourceName(ResourceName.Ammo),
        this.getSageGame().getCargoTypeKeyByMint(miningMineItem.data.data.mint),
        this.getSageGame().getCargoStatsDefinition().key,
        this.getSageGame().getGameState().key,
        this.getSageGame().getGame().key,
        ixFleetCargoHoldFoodAta.address,
        ixFleetAmmoBankAmmoAta.address,
        miningResourceFrom,
        ixFleetCargoHoldMintAta.address,
        this.getSageGame().getResourcesMint().Food,
        this.getSageGame().getResourcesMint().Ammo
      );
      ixs.push(ix_0);

      const input: StopMiningAsteroidInput = { keyIndex: 0 };

      const ix_1 = Fleet.stopMiningAsteroid(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getCargoProgram(),
        this.getSageGame().getPointsProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        this.fleet.key,
        miningMineItem.data.key,
        miningResource.data.key,
        planetKey,
        this.fleet.data.fuelTank,
        this.getSageGame().getCargoTypeByResourceName(ResourceName.Fuel),
        this.getSageGame().getCargoStatsDefinition().key,
        this.player.getMiningXpKey(),
        this.getSageGame().getGamePoints().miningXpCategory.category,
        this.getSageGame().getGamePoints().miningXpCategory.modifier,
        this.player.getPilotXpKey(),
        this.getSageGame().getGamePoints().pilotXpCategory.category,
        this.getSageGame().getGamePoints().pilotXpCategory.modifier,
        this.player.getCouncilRankXpKey(),
        this.getSageGame().getGamePoints().councilRankXpCategory.category,
        this.getSageGame().getGamePoints().councilRankXpCategory.modifier,
        this.getSageGame().getGameState().key,
        this.getSageGame().getGame().key,
        ixFleetFuelTankFuelAta.address,
        this.getSageGame().getResourcesMint().Fuel,
        input,
      );
      ixs.push(ix_1);
      
      return { type: "Success" as const, ixs };
    }
    /** END MINING */
    
    /** TRAVEL */
    async ixDockToStarbase() {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };
      
      if (this.state.StarbaseLoadingBay) return { type: "FleetIsDocked" as const };
      if (this.state.MineAsteroid) return { type: "FleetIsMining" as const };

      const ixs: InstructionReturn[] = [];
      
      const fleetCurrentSector = this.getCurrentSector();
      if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

      const currentStarbase = this.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates);
      if (currentStarbase.type !== "Success") return currentStarbase;

      const starbasePlayerKey = this.player.getStarbasePlayerAddress(currentStarbase.data);
      const starbasePlayer = await this.player.getStarbasePlayerByStarbaseAsync(currentStarbase.data);
      //console.log(starbasePlayer.data?.key.toBase58())
      
      const starbasePlayerPod = await this.player.getStarbasePlayerPodAsync(currentStarbase.data);
      //console.log(starbasePlayerPod.data?.key.toBase58())

      if (starbasePlayer.type !== "Success") {
        const ix_0 = StarbasePlayer.registerStarbasePlayer(
          this.getSageGame().getSageProgram(),
          this.player.getProfileFactionAddress(),
          this.player.getSagePlayerProfileAddress(),
          currentStarbase.data.key,
          this.getSageGame().getGame().key,
          this.getSageGame().getGameState().key,
          currentStarbase.data.data.seqId
        );
        ixs.push(ix_0);
      }

      if (starbasePlayerPod.type !== "Success") {
        const podSeedBuffer = Keypair.generate().publicKey.toBuffer();
        const podSeeds = Array.from(podSeedBuffer);

        const cargoInput: StarbaseCreateCargoPodInput = {
          keyIndex: 0,
          podSeeds,
        };

        const ix_1 = StarbasePlayer.createCargoPod(
          this.getSageGame().getSageProgram(),
          this.getSageGame().getCargoProgram(),
          starbasePlayerKey,
          this.getSageGame().getAsyncSigner(),
          this.player.getPlayerProfile().key,
          this.player.getProfileFactionAddress(),
          currentStarbase.data.key,
          this.getSageGame().getCargoStatsDefinition().key,
          this.getSageGame().getGame().key,
          this.getSageGame().getGameState().key,
          cargoInput
        );
        ixs.push(ix_1);
      };

      const input: IdleToLoadingBayInput = 0;

      // Movement Handler
      const ix_movement = await this.ixMovementHandler();
      if (ix_movement.type !== "Success") return ix_movement;
      if (ix_movement.ixs.length > 0) ixs.push(...ix_movement.ixs);

      const ix_2 = Fleet.idleToLoadingBay(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        this.fleet.key,
        currentStarbase.data.key,
        starbasePlayerKey,
        this.getSageGame().getGame().key,
        this.getSageGame().getGameState().key,
        input
      );
      ixs.push(ix_2);

      return { type: "Success" as const, ixs };
    }

    async ixUndockFromStarbase() {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      if (this.state.Idle) return { type: "FleetIsIdle" as const };
      if (this.state.MineAsteroid) return { type: "FleetIsMining" as const };
      if (this.state.MoveWarp || this.state.MoveSubwarp) return { type: "FleetIsMoving" as const };

      const ixs: InstructionReturn[] = [];

      const fleetCurrentSector = await this.getCurrentSector();
      if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

      const currentStarbase = this.getSageGame().getStarbaseByCoords(fleetCurrentSector.coordinates);
      if (currentStarbase.type !== "Success") return currentStarbase;

      const starbasePlayerKey = this.player.getStarbasePlayerAddress(currentStarbase.data);

      const input: LoadingBayToIdleInput = 0;

      const ix_1 = Fleet.loadingBayToIdle(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        this.fleet.key,
        currentStarbase.data.key,
        starbasePlayerKey,
        this.getSageGame().getGame().key,
        this.getSageGame().getGameState().key,
        input
      );
      ixs.push(ix_1);

      return { type: "Success" as const, ixs };
    }

    async ixWarpToSector(sector: SectorRoute, fuelNeeded: BN) {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      if (this.state.MineAsteroid) return { type: "FleetIsMining" as const };
      if (this.state.StarbaseLoadingBay) return { type: "FleetIsDocked" as const };

      const ixs: InstructionReturn[] = [];

      const fuelMint = this.getSageGame().getResourceMintByName(ResourceName.Fuel);
      
      const fuelTank = this.getFuelTank()
      
      const [fuelInTankData] = fuelTank.resources.filter((item) => item.mint.equals(fuelMint));
      if (!fuelInTankData) return { type: "FleetFuelTankIsEmpty" as const };

      if (fuelInTankData.amount.lt(fuelNeeded)) 
        return { type: "NoEnoughFuelToWarp" as const };

      const input: WarpToCoordinateInput = { keyIndex: 0, toSector: sector.coordinates as [BN, BN] };

      // Movement Handler
      const ix_movement = await this.ixMovementHandler();
      if (ix_movement.type !== "Success") return ix_movement;
      if (ix_movement.ixs.length > 0) ixs.push(...ix_movement.ixs);

      const ix_0 = Fleet.warpToCoordinate(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        this.fleet.key,
        fuelTank.key,
        this.getSageGame().getCargoTypeKeyByMint(fuelMint),
        this.getSageGame().getCargoStatsDefinition().key,
        fuelInTankData.tokenAccountKey,
        fuelMint,
        this.getSageGame().getGameState().key,
        this.getSageGame().getGame().key,
        this.getSageGame().getCargoProgram(),
        input
      );

      ixs.push(ix_0);

      return { type: "Success" as const, ixs };
    }

    async ixSubwarpToSector(sector: SectorRoute, fuelNeeded: BN) {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      if (this.state.MineAsteroid) return { type: "FleetIsMining" as const };
      if (this.state.StarbaseLoadingBay) return { type: "FleetIsDocked" as const };
      
      const ixs: InstructionReturn[] = [];
      
      const fuelMint = this.getSageGame().getResourceMintByName(ResourceName.Fuel);
      
      const fuelTank = this.getFuelTank();
      
      if (fuelNeeded.gt(new BN(0))) { // Temporary for Subwarp bug
        const [fuelInTankData] = fuelTank.resources.filter((item) => item.mint.equals(fuelMint));
        if (!fuelInTankData) return { type: "FleetFuelTankIsEmpty" as const };

        if (fuelInTankData.amount.lt(fuelNeeded)) 
          return { type: "NoEnoughFuelToSubwarp" as const };
      }

      const input = { keyIndex: 0, toSector: sector.coordinates as [BN, BN] } as StartSubwarpInput;

      // Movement Handler
      const ix_movement = await this.ixMovementHandler();
      if (ix_movement.type !== "Success") return ix_movement;
      if (ix_movement.ixs.length > 0) ixs.push(...ix_movement.ixs);

      const ix_0 = Fleet.startSubwarp(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        this.fleet.key,
        this.getSageGame().getGame().key,
        this.getSageGame().getGameState().key,
        input
      );

      ixs.push(ix_0);

      return { type: "Success" as const, ixs };
    }

    async ixMovementHandler() { // Warp and Subwarp Handler
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };

      const ixs: InstructionReturn[] = [];

      const fuelMint = this.getSageGame().getResourceMintByName(ResourceName.Fuel);
      
      const fuelTank = this.getFuelTank();
      
      // const [fuelInTankData] = fuelTank.resources.filter((item) => item.mint.equals(fuelMint));
      // if (!fuelInTankData || fuelInTankData.amount.eq(new BN(0))) return { type: "FleetFuelTankIsEmpty" as const }; // Temporary disabled for Subwarp Bug
      const ixFleetFuelTankMintAta = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(fuelTank.key, fuelMint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixFleetFuelTankMintAta.address);
      } catch (e) {
        ixs.push(ixFleetFuelTankMintAta.instruction);
      }

      const currentTimestamp: BN = new BN(await this.getSageGame().getCurrentTimestampOnChain());
      
      /* console.log(this.fleet.state.MoveSubwarp?.arrivalTime.toNumber())
      console.log(currentTimestamp.toNumber()) */

      const ix_movement = this.fleet.state.MoveWarp && (!this.fleet.state.MoveWarp.warpFinish || this.fleet.state.MoveWarp.warpFinish.lt(currentTimestamp)) ? 
        [Fleet.moveWarpHandler(
          this.getSageGame().getSageProgram(),
          this.getSageGame().getPointsProgram(),
          this.getPlayer().getPlayerProfile().key,
          this.key,
          this.player.getPilotXpKey(),
          this.getSageGame().getGamePoints().pilotXpCategory.category,
          this.getSageGame().getGamePoints().pilotXpCategory.modifier,
          this.player.getCouncilRankXpKey(),
          this.getSageGame().getGamePoints().councilRankXpCategory.category,
          this.getSageGame().getGamePoints().councilRankXpCategory.modifier,
          this.getSageGame().getGame().key,
        )] : this.fleet.state.MoveSubwarp && (!this.fleet.state.MoveSubwarp.arrivalTime || this.fleet.state.MoveSubwarp.arrivalTime.lt(currentTimestamp)) ?
        [Fleet.movementSubwarpHandler(
          this.getSageGame().getSageProgram(),
          this.getSageGame().getCargoProgram(),
          this.getSageGame().getPointsProgram(),
          this.getPlayer().getPlayerProfile().key,
          this.key,
          fuelTank.key,
          this.getSageGame().getCargoTypeKeyByMint(fuelMint),
          this.getSageGame().getCargoStatsDefinition().key,
          // fuelInTankData.tokenAccountKey,
          ixFleetFuelTankMintAta.address,
          fuelMint,
          this.player.getPilotXpKey(),
          this.getSageGame().getGamePoints().pilotXpCategory.category,
          this.getSageGame().getGamePoints().pilotXpCategory.modifier,
          this.player.getCouncilRankXpKey(),
          this.getSageGame().getGamePoints().councilRankXpCategory.category,
          this.getSageGame().getGamePoints().councilRankXpCategory.modifier,
          this.getSageGame().getGame().key,
        )] : [];

        ixs.push(...ix_movement)

        return { type: "Success" as const, ixs };
    }
    /** END TRAVEL */

    /** SCANNING */
    async ixScanForSurveyDataUnits() {
      const update = await this.update();
      if (update.type !== "Success") return { type: "FleetFailedToUpdate" as const };
      
      if (this.state.MineAsteroid) return { type: "FleetIsMining" as const };
      if (this.state.StarbaseLoadingBay) return { type: "FleetIsDocked" as const };

      const ixs: InstructionReturn[] = [];

      const foodMint = this.getSageGame().getResourceMintByName(ResourceName.Food)
      const sduMint = this.getSageGame().getResourceMintByName(ResourceName.Sdu)

      const fleetCurrentSector = this.getCurrentSector();
      if (!fleetCurrentSector) return { type: "FleetCurrentSectorError" as const };

      const cargoHold = this.getCargoHold();

      if (this.onlyDataRunner && cargoHold.fullLoad) return { type: "FleetCargoIsFull" as const }

      if (!this.onlyDataRunner) {
        const [foodInCargoData] = cargoHold.resources.filter((item) => item.mint.equals(foodMint));

        if (!foodInCargoData || foodInCargoData.amount.lt(new BN(this.stats.miscStats.scanCost))) 
          return { type: "NoEnoughFood" as const }

        if (cargoHold.fullLoad && !foodInCargoData.amount.eq(cargoHold.maxCapacity))
          return { type: "FleetCargoIsFull" as const }
      }

      const sduTokenFrom = getAssociatedTokenAddressSync(
        sduMint,
        this.getSageGame().getSuvreyDataUnitTracker().data.signer,
        true
      );

      const ixSduTokenTo = this.getSageGame().ixCreateAssociatedTokenAccountIdempotent(cargoHold.key, sduMint)
      try {
        await getAccount(this.getSageGame().getProvider().connection, ixSduTokenTo.address);
      } catch (e) {
        ixs.push(ixSduTokenTo.instruction);
      }

      const foodTokenFrom = getAssociatedTokenAddressSync(
        foodMint,
        cargoHold.key,
        true
      );  

      const input: ScanForSurveyDataUnitsInput = { keyIndex: 0 };

      // Movement Handler
      const ix_movement = await this.ixMovementHandler();
      if (ix_movement.type !== "Success") return ix_movement;
      if (ix_movement.ixs.length > 0) ixs.push(...ix_movement.ixs);

      const ix_0 = SurveyDataUnitTracker.scanForSurveyDataUnits(
        this.getSageGame().getSageProgram(),
        this.getSageGame().getCargoProgram(),
        this.getSageGame().getPointsProgram(),
        this.getSageGame().getAsyncSigner(),
        this.player.getPlayerProfile().key,
        this.player.getProfileFactionAddress(),
        this.fleet.key,
        fleetCurrentSector.key,
        this.getSageGame().getSuvreyDataUnitTracker().key,
        cargoHold.key,
        this.getSageGame().getCargoTypeByResourceName(ResourceName.Sdu),
        this.getSageGame().getCargoTypeByResourceName(ResourceName.Food),
        this.getSageGame().getCargoStatsDefinition().key,
        sduTokenFrom,
        ixSduTokenTo.address,
        foodTokenFrom,
        foodMint,
        this.player.getDataRunningXpKey(),
        this.getSageGame().getGamePoints().dataRunningXpCategory.category,
        this.getSageGame().getGamePoints().dataRunningXpCategory.modifier,
        this.player.getCouncilRankXpKey(),
        this.getSageGame().getGamePoints().councilRankXpCategory.category,
        this.getSageGame().getGamePoints().councilRankXpCategory.modifier,
        this.getSageGame().getGame().key,
        this.getSageGame().getGameState().key,
        input
      );

      ixs.push(ix_0);

      return { type: "Success" as const, ixs };
    }
    /** END SCANNING */

    /** END SAGE INSTRUCTIONS */
}


function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}
// !! usa più spesso createAssociatedTokenAccountIdempotent
// !! usa più spesso getAssociatedTokenAddressSync