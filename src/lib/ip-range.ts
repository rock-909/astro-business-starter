const BIGINT_ZERO = 0n;
const IPV4_BITS_PER_OCTET = 8;
const IPV4_OCTET_COUNT = 4;
const IPV4_MAX_OCTET = 255;
const IPV4_SEGMENT_MASK = 0xffff;
const IPV6_BITS_PER_SEGMENT = 16;
const IPV6_SEGMENT_COUNT = 8;
const IPV6_PREFIX_SHIFT_BITS = 64n;
const IPV4_MAPPED_IPV6_PREFIX = 0xffffn;
const IPV4_ADDRESS_MASK = 0xffffffffn;
const IPV4_MAPPED_IPV6_PREFIX_SHIFT_BITS = 32n;
const IPV4_MAPPED_IPV6_UPPER_SHIFT_BITS = 96n;

function parseIPv6Segment(segment: string): bigint | null {
  return /^[0-9a-fA-F]{1,4}$/.test(segment) ? BigInt(`0x${segment}`) : null;
}

function splitIPv6Side(side: string): string[] {
  return side === '' ? [] : side.split(':');
}

export function ipv4ToInteger(ip: string): number | null {
  const segments = ip.split('.');
  if (segments.length !== IPV4_OCTET_COUNT) return null;

  let value = 0;
  for (const segment of segments) {
    if (!/^\d+$/u.test(segment)) return null;
    if (segment.length > 1 && segment[0] === '0') return null;

    const octet = Number.parseInt(segment, 10);
    if (octet > IPV4_MAX_OCTET) {
      return null;
    }

    value = (value << IPV4_BITS_PER_OCTET) + octet;
  }

  return value >>> 0;
}

export function integerToIpv4(value: number): string {
  const normalized = value >>> 0;
  return [
    (normalized >>> 24) & IPV4_MAX_OCTET,
    (normalized >>> 16) & IPV4_MAX_OCTET,
    (normalized >>> 8) & IPV4_MAX_OCTET,
    normalized & IPV4_MAX_OCTET,
  ].join('.');
}

interface IPv6SegmentSideOptions {
  side: 'left' | 'right';
  hasCompression: boolean;
}

function normalizeIPv6Segments(
  segments: string[],
  options: IPv6SegmentSideOptions,
): string[] | null {
  const lastSegment = segments.at(-1);
  if (lastSegment?.includes('.')) {
    if (options.hasCompression && options.side === 'left') {
      return null;
    }

    const ipv4Value = ipv4ToInteger(lastSegment);
    if (ipv4Value === null) return null;

    if (options.hasCompression) {
      if (
        options.side !== 'right' ||
        segments.slice(0, -1).some((segment) => segment.includes('.'))
      ) {
        return null;
      }
    } else if (segments.length !== 7) {
      return null;
    }

    const normalized = segments.slice(0, -1);
    normalized.push(((ipv4Value >>> IPV6_BITS_PER_SEGMENT) & IPV4_SEGMENT_MASK).toString(16));
    normalized.push((ipv4Value & IPV4_SEGMENT_MASK).toString(16));
    return normalized;
  }

  return segments;
}

export function ipv6ToBigInt(ip: string): bigint | null {
  const compressionIndex = ip.indexOf('::');
  const hasCompression = compressionIndex !== -1;

  const leftRaw = hasCompression ? ip.slice(0, compressionIndex) : ip;
  const rightRaw = hasCompression ? ip.slice(compressionIndex + 2) : '';

  const leftSegments = normalizeIPv6Segments(splitIPv6Side(leftRaw), {
    side: 'left',
    hasCompression,
  });
  const rightSegments = normalizeIPv6Segments(splitIPv6Side(rightRaw), {
    side: 'right',
    hasCompression,
  });

  if (leftSegments === null || rightSegments === null) return null;

  const totalProvided = leftSegments.length + rightSegments.length;
  const missingSegments = IPV6_SEGMENT_COUNT - totalProvided;
  const validCount = hasCompression ? missingSegments > 0 : missingSegments === 0;
  if (!validCount) return null;

  const segments = hasCompression
    ? [...leftSegments, ...Array.from({ length: missingSegments }, () => '0'), ...rightSegments]
    : leftSegments;

  return segments.reduce<bigint | null>((accumulator, segment) => {
    if (accumulator === null) return null;

    const value = parseIPv6Segment(segment);
    if (value === null) {
      return null;
    }

    return (accumulator << BigInt(IPV6_BITS_PER_SEGMENT)) + value;
  }, BIGINT_ZERO);
}

export function ipv6NetworkPrefix64(ip: string): bigint | null {
  const value = ipv6ToBigInt(ip);
  if (value === null) {
    return null;
  }

  return value >> IPV6_PREFIX_SHIFT_BITS;
}

export function ipv4MappedEmbeddedAddress(ip: string): number | null {
  const value = ipv6ToBigInt(ip);
  if (value === null) {
    return null;
  }

  if (value >> IPV4_MAPPED_IPV6_UPPER_SHIFT_BITS !== BIGINT_ZERO) {
    return null;
  }

  if (value >> IPV4_MAPPED_IPV6_PREFIX_SHIFT_BITS !== IPV4_MAPPED_IPV6_PREFIX) {
    return null;
  }

  return Number(value & IPV4_ADDRESS_MASK) >>> 0;
}
