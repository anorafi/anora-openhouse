import { encodeAbiParameters, encodeEventTopics, type Abi, type Hex } from "viem";
import { AnoraFacilityAbi } from "../../web/src/abi/AnoraFacility";
import { AnoraFactoryAbi } from "../../web/src/abi/AnoraFactory";
import type { RawLog } from "./events";

const ABI = [...AnoraFacilityAbi, ...AnoraFactoryAbi] as Abi;

export interface LogMeta {
  address: string;
  blockNumber: number;
  blockHash?: string;
  txHash?: string;
  logIndex?: number;
}

export function makeLog(eventName: string, args: Record<string, unknown>, meta: LogMeta): RawLog {
  const item = ABI.find((entry) => entry.type === "event" && entry.name === eventName);
  if (!item || item.type !== "event") throw new Error(`Unknown event ${eventName}`);
  const topics = encodeEventTopics({ abi: ABI, eventName, args } as never) as Hex[];
  const plain = item.inputs.filter((input) => !input.indexed);
  const data = plain.length === 0 ? "0x" : encodeAbiParameters(plain, plain.map((input) => args[input.name as string]) as never);
  const number = BigInt(meta.blockNumber);
  return {
    address: meta.address as Hex,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber: number,
    blockHash: (meta.blockHash ?? `0x${number.toString(16).padStart(64, "0")}`) as Hex,
    transactionHash: (meta.txHash ?? `0x${(number * 1000n + BigInt(meta.logIndex ?? 0)).toString(16).padStart(64, "0")}`) as Hex,
    logIndex: meta.logIndex ?? 0,
  };
}
