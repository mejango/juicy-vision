import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from 'viem'

/** Compute the V6 721 pay metadata ID from the hook implementation target. */
function computeNftPayMetadataId(metadataIdTarget: Address): Hex {
  const purposeBytes20 = keccak256(toBytes('pay')).slice(0, 42)
  const xor = BigInt(purposeBytes20) ^ BigInt(metadataIdTarget.toLowerCase())
  const xorHex = xor.toString(16).padStart(40, '0')
  return `0x${xorHex.slice(0, 8)}` as Hex
}

/** Build the exact JBMetadataResolver payload used for a V6 721 tier payment. */
export function buildNftPayMetadata(metadataIdTarget: Address, tierIds: number[]): Hex {
  if (
    tierIds.length === 0 ||
    tierIds.some((id) => !Number.isInteger(id) || id <= 0 || id > 0xffff)
  ) {
    throw new Error('Invalid NFT tier selection')
  }

  const tierData = encodeAbiParameters(
    [{ type: 'bool' }, { type: 'uint16[]' }],
    [true, tierIds],
  )
  const dataHex = tierData.slice(2)
  const paddedDataHex = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, '0')

  return `0x${'00'.repeat(32)}${computeNftPayMetadataId(metadataIdTarget).slice(2)}02${
    '00'.repeat(27)
  }${paddedDataHex}` as Hex
}
