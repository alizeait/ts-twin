import type {
  Candidate,
  DuplicateGroup,
  FunctionOccurrence,
  ShingleId,
} from './types';

/**
 * Saturation scale for the `1 - exp(-evidence / EVIDENCE_SCALE)` curve.
 * Higher values keep the saturation factor below 1 for longer, which prevents
 * very long but only-narrowly-differing functions from scoring close to 1.0
 * (the "sparse-divergence-in-long-boilerplate" false-positive mode).
 */
const EVIDENCE_SCALE = 40;
const MIN_EVIDENCE = 12;

type Union = {
  parent: Int32Array;
  rank: Int32Array;
};

type ScoredPair = {
  left: number;
  right: number;
  score: number;
};

/**
 * Internal indexed representation. Shingles live in two parallel arrays
 * sorted ascending by id; `weightedCounts[i]` is `shingleCounts[i] *
 * idfWeight(shingleIds[i])`, pre-multiplied so the pair-comparison hot path
 * doesn't need to read the weight map.
 */
type IndexedCandidate = Candidate & {
  weightedCounts: Float64Array;
  shingleCount: number;
  totalWeight: number;
};

/**
 * Inverted-index bucket for one shingle within one language family. The
 * `candidates` and `weightedCounts` typed arrays are pre-sized to the exact
 * number of candidates that contain this shingle, which makes the
 * comparison hot path a tight sequential walk over contiguous memory —
 * dramatically faster than walking parallel `number[]` arrays.
 */
type ShingleBucket = {
  candidates: Int32Array;
  weightedCounts: Float64Array;
};

type FamilyIndex = {
  members: number[];
  shingleIndex: Map<ShingleId, ShingleBucket>;
};

export function groupDuplicates(
  candidates: Candidate[],
  minScore: number,
): DuplicateGroup[] {
  const weights = computeWeights(candidates);
  const indexed = candidates.map((candidate) =>
    indexCandidate(candidate, weights),
  );
  const union = createUnion(indexed.length);
  const pairScores: ScoredPair[] = [];

  for (const family of buildFamilyIndices(indexed).values()) {
    compareFamily(family, indexed, union, pairScores, minScore);
  }

  return buildGroups(indexed, union, pairScores);
}

/**
 * Computes document-frequency-based IDF weights across all candidates.
 *
 * Common shingles (high df) get low weight; rare shingles (low df) get high
 * weight. The `+1` keeps singletons in the mix and guarantees every weight
 * is `>= 1`, which makes unique-shared-shingle-count a strict lower bound on
 * weighted evidence (used as a fast pre-filter below).
 */
function computeWeights(candidates: Candidate[]): Map<ShingleId, number> {
  const documentFrequency = new Map<ShingleId, number>();
  for (let i = 0; i < candidates.length; i += 1) {
    const ids = candidates[i].shingleIds;
    for (let j = 0; j < ids.length; j += 1) {
      const id = ids[j];
      documentFrequency.set(id, (documentFrequency.get(id) ?? 0) + 1);
    }
  }

  const total = candidates.length;
  const weights = new Map<ShingleId, number>();
  for (const [shingle, count] of documentFrequency) {
    weights.set(shingle, Math.log2((total + 1) / (count + 1)) + 1);
  }
  return weights;
}

/**
 * Builds the per-family inverted shingle index.
 *
 * Each shingle maps to a `ShingleBucket` carrying the indices of candidates
 * that contain it plus their pre-multiplied weighted counts. Storing the
 * weighted count in the bucket means the comparison hot path can compute the
 * full weighted evidence in a single index walk — without a separate
 * `Map.get(weights, shingle)` lookup or a subsequent two-pointer merge pass.
 *
 * Two passes are used: the first counts per-family document frequency so we
 * can allocate exact-size typed arrays; the second populates them.
 */
function buildFamilyIndices(
  indexed: IndexedCandidate[],
): Map<string, FamilyIndex> {
  type Builder = {
    members: number[];
    sizes: Map<ShingleId, number>;
  };

  const builders = new Map<string, Builder>();
  for (let i = 0; i < indexed.length; i += 1) {
    const candidate = indexed[i];
    let builder = builders.get(candidate.language);
    if (!builder) {
      builder = { members: [], sizes: new Map() };
      builders.set(candidate.language, builder);
    }
    builder.members.push(i);
    const ids = candidate.shingleIds;
    for (let j = 0; j < ids.length; j += 1) {
      const id = ids[j];
      builder.sizes.set(id, (builder.sizes.get(id) ?? 0) + 1);
    }
  }

  const families = new Map<string, FamilyIndex>();
  for (const [language, builder] of builders) {
    const shingleIndex = new Map<ShingleId, ShingleBucket>();
    const offsets = new Map<ShingleId, number>();
    for (const [id, size] of builder.sizes) {
      shingleIndex.set(id, {
        candidates: new Int32Array(size),
        weightedCounts: new Float64Array(size),
      });
      offsets.set(id, 0);
    }

    for (const i of builder.members) {
      const candidate = indexed[i];
      const ids = candidate.shingleIds;
      const weighted = candidate.weightedCounts;
      for (let j = 0; j < ids.length; j += 1) {
        const id = ids[j];
        const bucket = shingleIndex.get(id) as ShingleBucket;
        const offset = offsets.get(id) as number;
        bucket.candidates[offset] = i;
        bucket.weightedCounts[offset] = weighted[j];
        offsets.set(id, offset + 1);
      }
    }

    families.set(language, { members: builder.members, shingleIndex });
  }
  return families;
}

function compareFamily(
  family: FamilyIndex,
  indexed: IndexedCandidate[],
  union: Union,
  pairScores: ScoredPair[],
  minScore: number,
) {
  // Per outer iteration, accumulate the exact weighted shared evidence for
  // every candidate that shares at least one shingle with `left`. Because
  // `min(a*w, b*w) === w * min(a, b)` for non-negative `a, b, w`, summing
  // `min(left.weightedCounts[i], bucket.weightedCounts[k])` during the index
  // walk yields the same value as the previous separate two-pointer merge —
  // but with no second pass and no Map.get inside the hot loop.
  const sharedEvidence = new Float64Array(indexed.length);
  const touched = new Int32Array(indexed.length);
  let touchedLen = 0;

  const members = family.members;
  const shingleIndex = family.shingleIndex;

  for (let m = 0; m < members.length; m += 1) {
    const leftIdx = members[m];
    const left = indexed[leftIdx];

    // Reset only the slots we touched last iteration — O(touchedLen), not O(N).
    for (let k = 0; k < touchedLen; k += 1) sharedEvidence[touched[k]] = 0;
    touchedLen = 0;

    const leftIds = left.shingleIds;
    const leftWeighted = left.weightedCounts;
    const leftIdsLen = leftIds.length;
    for (let s = 0; s < leftIdsLen; s += 1) {
      const bucket = shingleIndex.get(leftIds[s]);
      if (!bucket) continue;
      const bucketIds = bucket.candidates;
      const bucketWeighted = bucket.weightedCounts;
      const bucketLen = bucketIds.length;
      const leftW = leftWeighted[s];
      for (let k = 0; k < bucketLen; k += 1) {
        const otherIdx = bucketIds[k];
        if (otherIdx <= leftIdx) continue;
        const otherW = bucketWeighted[k];
        const contribution = leftW < otherW ? leftW : otherW;
        if (sharedEvidence[otherIdx] === 0) {
          touched[touchedLen] = otherIdx;
          touchedLen += 1;
        }
        sharedEvidence[otherIdx] += contribution;
      }
    }

    const leftTotal = left.totalWeight;
    const leftShingleCount = left.shingleCount;
    for (let t = 0; t < touchedLen; t += 1) {
      const rightIdx = touched[t];
      const evidence = sharedEvidence[rightIdx];
      if (evidence < MIN_EVIDENCE) continue;

      const right = indexed[rightIdx];
      const rightShingleCount = right.shingleCount;
      // Inlined `canCompare`: size ratio must be at least 0.5.
      const minCount =
        leftShingleCount < rightShingleCount
          ? leftShingleCount
          : rightShingleCount;
      const maxCount =
        leftShingleCount > rightShingleCount
          ? leftShingleCount
          : rightShingleCount;
      if (maxCount === 0 || minCount * 2 < maxCount) continue;

      const denom = leftTotal + right.totalWeight - evidence;
      if (denom === 0) continue;
      const weighted = evidence / denom;
      // The saturation factor is in (0, 1), so `weighted` alone must already
      // exceed `minScore`. Skipping here avoids the relatively expensive
      // `Math.exp` call for the (large) majority of touched pairs.
      if (weighted < minScore) continue;

      const score = weighted * (1 - Math.exp(-evidence / EVIDENCE_SCALE));
      if (score < minScore) continue;

      merge(union, left.id, right.id);
      pairScores.push({ left: left.id, right: right.id, score });
    }
  }
}

function indexCandidate(
  candidate: Candidate,
  weights: Map<ShingleId, number>,
): IndexedCandidate {
  const ids = candidate.shingleIds;
  const counts = candidate.shingleCounts;
  const weightedCounts = new Float64Array(ids.length);

  let shingleCount = 0;
  let totalWeight = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const w = (weights.get(ids[i]) ?? 1) * counts[i];
    weightedCounts[i] = w;
    shingleCount += counts[i];
    totalWeight += w;
  }
  return { ...candidate, weightedCounts, shingleCount, totalWeight };
}

function buildGroups(
  indexed: IndexedCandidate[],
  union: Union,
  pairScores: ScoredPair[],
): DuplicateGroup[] {
  // Bucket candidates by union-find root with in-place mutation so this is
  // O(N) instead of O(N^2) (the original spread-based version was quadratic
  // on a codebase with a single very large connected component).
  const rootMembers = new Map<number, IndexedCandidate[]>();
  for (let i = 0; i < indexed.length; i += 1) {
    const candidate = indexed[i];
    const root = find(union, candidate.id);
    const list = rootMembers.get(root);
    if (list) list.push(candidate);
    else rootMembers.set(root, [candidate]);
  }

  // One pass through pairScores to find the minimum score per group.
  const rootScore = new Map<number, number>();
  for (let i = 0; i < pairScores.length; i += 1) {
    const { left, score } = pairScores[i];
    const root = find(union, left);
    const previous = rootScore.get(root);
    if (previous === undefined || score < previous) rootScore.set(root, score);
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, members] of rootMembers) {
    if (members.length < 2) continue;
    groups.push({
      score: rootScore.get(root) ?? 1,
      functions: members
        .map(stripCandidate)
        .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    });
  }

  return groups.sort(sortGroups);
}

function sortGroups(left: DuplicateGroup, right: DuplicateGroup): number {
  return (
    right.score - left.score ||
    right.functions.length - left.functions.length ||
    totalTokens(right) - totalTokens(left)
  );
}

function stripCandidate(candidate: Candidate): FunctionOccurrence {
  return {
    id: candidate.id,
    file: candidate.file,
    line: candidate.line,
    start: candidate.start,
    end: candidate.end,
    name: candidate.name,
    nodes: candidate.nodes,
    tokens: candidate.tokens,
  };
}

function totalTokens(group: DuplicateGroup): number {
  let total = 0;
  for (let i = 0; i < group.functions.length; i += 1) {
    total += group.functions[i].tokens;
  }
  return total;
}

function createUnion(size: number): Union {
  const parent = new Int32Array(size);
  for (let i = 0; i < size; i += 1) parent[i] = i;
  return { parent, rank: new Int32Array(size) };
}

/**
 * Iterative union-find with path compression. The previous recursive
 * implementation could overflow the call stack on pathological inputs and
 * was also slower per call due to function-call overhead.
 */
function find(union: Union, index: number): number {
  let root = index;
  while (union.parent[root] !== root) root = union.parent[root];
  let current = index;
  while (union.parent[current] !== root) {
    const next = union.parent[current];
    union.parent[current] = root;
    current = next;
  }
  return root;
}

function merge(union: Union, left: number, right: number) {
  const leftRoot = find(union, left);
  const rightRoot = find(union, right);
  if (leftRoot === rightRoot) return;

  if (union.rank[leftRoot] < union.rank[rightRoot]) {
    union.parent[leftRoot] = rightRoot;
    return;
  }

  union.parent[rightRoot] = leftRoot;
  if (union.rank[leftRoot] === union.rank[rightRoot]) union.rank[leftRoot] += 1;
}
