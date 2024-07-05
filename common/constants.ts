import { PublicKey } from "@solana/web3.js";
import { homedir } from "os";
import path from "path";
import { KeypairPath, RpcPath } from "./types";
import { BN } from "@staratlas/anchor";
import { SectorCoordinates } from "./types";

export const MAX_AMOUNT = 999_999_999;

export const quattrinoTokenPubkey = new PublicKey(
  "qtr6BUeMKtt65HdYxXm75fLZ19184w4Yh4ZaPp4Ppks"
);

export const startOptions = ["Start", "Settings"];

export const resetOptions = [
  "Reset Profile 1 - Keypair",
  "Reset Profile 1 - RPC",
  "Reset Profile 2 - Keypair",
  "Reset Profile 2 - RPC",
  "Reset Profile 3 - Keypair",
  "Reset Profile 3 - RPC",
];

export const profiles = ["Profile 1", "Profile 2", "Profile 3"] as const;

export type Profile = (typeof profiles)[number];

export const activites = ["Mining", "Cargo", "Combo", "Scan", "Craft"];

export const configDir1 = path.join(homedir(), ".ultronConfig1");
export const configDir2 = path.join(homedir(), ".ultronConfig2");
export const configDir3 = path.join(homedir(), ".ultronConfig3");

const rpcPath = (configDir: string) => path.join(configDir, "rpc.txt");

export const rpcPaths: RpcPath = {
  "Profile 1": rpcPath(configDir1),
  "Profile 2": rpcPath(configDir2),
  "Profile 3": rpcPath(configDir3),
};

const keypairPath = (configDir: string) => path.join(configDir, "keypair.json");

export const keypairPaths: KeypairPath = {
  "Profile 1": keypairPath(configDir1),
  "Profile 2": keypairPath(configDir2),
  "Profile 3": keypairPath(configDir3),
};

export const verifiedRpc = [
  "rpc.hellomoon.io",
  "solana-mainnet.g.alchemy.com",
  "mainnet.helius-rpc.com",
  "rpc.ironforge.network", // !! IronForge restituisce sempre un errore GENERICO StructError in caso di errore di un'istruzione
  "solana-mainnet.api.syndica.io",
  "solana-mainnet.quiknode.pro",
  "solana-mainnet.g.alchemy.com",
  "solana-mainnet.core.chainstack.com",
  "solana-mainnet.rpc.extrnode.com"
];

export enum MovementType {
  Warp = "Warp",
  Subwarp = "Subwarp",
}

export const movements = [
  MovementType.Warp,
  MovementType.Subwarp,
]

export enum PriorityLevel {
  None = "None",
  Default = "Default",
  Low = "Low",
  Medium = "Medium",
  High = "High",
  Custom = "Custom",
}

export enum PriorityLevelValue {
  Default = 0,
  Low = 10000,
  Medium = 100000,
  High = 500000,
  Limit = 1000000
}

export type CustomPriorityFee = {
  level: PriorityLevel;
  value?: number;
}

export const priority: PriorityLevel[] = [
  PriorityLevel.Default, 
  PriorityLevel.Low, 
  PriorityLevel.Medium, 
  PriorityLevel.High,
  PriorityLevel.Custom,
  PriorityLevel.None
];

export const starbasesInfo = [
  {
    name: "MUD",
    coords: [new BN(0), new BN(-39)] as SectorCoordinates,
  },
  {
    name: "MUD2",
    coords: [new BN(2), new BN(-34)] as SectorCoordinates,
  },
  {
    name: "MUD3",
    coords: [new BN(10), new BN(-41)] as SectorCoordinates,
  },
  {
    name: "MUD4",
    coords: [new BN(-2), new BN(-44)] as SectorCoordinates,
  },
  {
    name: "MUD5",
    coords: [new BN(-10), new BN(-37)] as SectorCoordinates,
  },
  {
    name: "MRZ1",
    coords: [new BN(-15), new BN(-33)] as SectorCoordinates,
  },
  {
    name: "MRZ2",
    coords: [new BN(12), new BN(-31)] as SectorCoordinates,
  },
  {
    name: "MRZ3",
    coords: [new BN(-22), new BN(-25)] as SectorCoordinates,
  },
  {
    name: "MRZ4",
    coords: [new BN(-8), new BN(-24)] as SectorCoordinates,
  },
  {
    name: "MRZ5",
    coords: [new BN(2), new BN(-23)] as SectorCoordinates,
  },
  {
    name: "MRZ6",
    coords: [new BN(11), new BN(-16)] as SectorCoordinates,
  },
  {
    name: "MRZ7",
    coords: [new BN(21), new BN(-26)] as SectorCoordinates,
  },
  {
    name: "MRZ8",
    coords: [new BN(-30), new BN(-16)] as SectorCoordinates,
  },
  {
    name: "MRZ9",
    coords: [new BN(-14), new BN(-16)] as SectorCoordinates,
  },
  {
    name: "MRZ10",
    coords: [new BN(23), new BN(-12)] as SectorCoordinates,
  },
  {
    name: "MRZ11",
    coords: [new BN(31), new BN(-19)] as SectorCoordinates,
  },
  {
    name: "MRZ12",
    coords: [new BN(-16), new BN(0)] as SectorCoordinates,
  },
  {
    name: "ONI",
    coords: [new BN(-40), new BN(30)] as SectorCoordinates,
  },
  {
    name: "ONI2",
    coords: [new BN(-42), new BN(35)] as SectorCoordinates,
  },
  {
    name: "ONI3",
    coords: [new BN(-30), new BN(30)] as SectorCoordinates,
  },
  {
    name: "ONI4",
    coords: [new BN(-38), new BN(25)] as SectorCoordinates,
  },
  {
    name: "ONI5",
    coords: [new BN(-47), new BN(30)] as SectorCoordinates,
  },
  {
    name: "MRZ13",
    coords: [new BN(-36), new BN(-7)] as SectorCoordinates,
  },
  {
    name: "MRZ14",
    coords: [new BN(-23), new BN(4)] as SectorCoordinates,
  },
  {
    name: "MRZ18",
    coords: [new BN(-40), new BN(3)] as SectorCoordinates,
  },
  {
    name: "MRZ19",
    coords: [new BN(-35), new BN(12)] as SectorCoordinates,
  },
  {
    name: "MRZ20",
    coords: [new BN(-25), new BN(15)] as SectorCoordinates,
  },
  {
    name: "MRZ24",
    coords: [new BN(-45), new BN(15)] as SectorCoordinates,
  },
  {
    name: "MRZ25",
    coords: [new BN(-18), new BN(23)] as SectorCoordinates,
  },
  {
    name: "MRZ26",
    coords: [new BN(-9), new BN(24)] as SectorCoordinates,
  },
  {
    name: "MRZ29",
    coords: [new BN(-22), new BN(32)] as SectorCoordinates,
  },
  {
    name: "MRZ30",
    coords: [new BN(-19), new BN(40)] as SectorCoordinates,
  },
  {
    name: "MRZ31",
    coords: [new BN(-8), new BN(35)] as SectorCoordinates,
  },
  {
    name: "MRZ36",
    coords: [new BN(0), new BN(16)] as SectorCoordinates,
  },
  {
    name: "Ustur",
    coords: [new BN(40), new BN(30)] as SectorCoordinates,
  },
  {
    name: "UST2",
    coords: [new BN(42), new BN(35)] as SectorCoordinates,
  },
  {
    name: "UST3",
    coords: [new BN(48), new BN(32)] as SectorCoordinates,
  },
  {
    name: "UST4",
    coords: [new BN(38), new BN(25)] as SectorCoordinates,
  },
  {
    name: "UST5",
    coords: [new BN(30), new BN(28)] as SectorCoordinates,
  },
  {
    name: "MRZ15",
    coords: [new BN(22), new BN(5)] as SectorCoordinates,
  },
  {
    name: "MRZ16",
    coords: [new BN(39), new BN(-1)] as SectorCoordinates,
  },
  {
    name: "MRZ17",
    coords: [new BN(16), new BN(-5)] as SectorCoordinates,
  },
  {
    name: "MRZ21",
    coords: [new BN(25), new BN(14)] as SectorCoordinates,
  },
  {
    name: "MRZ22",
    coords: [new BN(35), new BN(16)] as SectorCoordinates,
  },
  {
    name: "MRZ23",
    coords: [new BN(44), new BN(10)] as SectorCoordinates,
  },
  {
    name: "MRZ27",
    coords: [new BN(2), new BN(26)] as SectorCoordinates,
  },
  {
    name: "MRZ28",
    coords: [new BN(17), new BN(21)] as SectorCoordinates,
  },
  {
    name: "MRZ32",
    coords: [new BN(5), new BN(44)] as SectorCoordinates,
  },
  {
    name: "MRZ33",
    coords: [new BN(13), new BN(37)] as SectorCoordinates,
  },
  {
    name: "MRZ34",
    coords: [new BN(22), new BN(31)] as SectorCoordinates,
  },
  {
    name: "MRZ35",
    coords: [new BN(49), new BN(20)] as SectorCoordinates,
  },
];