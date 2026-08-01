import {
  largestDollarMention,
  largestNumericMention,
  type SelectablePost,
} from "./post-selection.js";

export interface SelectionSignals {
  largestDollarMention: number | null;
  largestPointsOrMilesMention: number | null;
  qualifyingSignalCount: number;
}

interface BigDealPost extends SelectablePost {
  derived: SelectablePost["derived"] & {
    selectionSignals: SelectionSignals;
  };
}

export function selectBigDeals(
  posts: SelectablePost[],
  limit: number,
): BigDealPost[] {
  return posts
    .flatMap((post) => {
      const searchableText = `${post.source.title}\n${post.source.articleText}`;
      const largestDollarAmount = largestDollarMention(searchableText);
      const largestPointsOrMilesMention = largestNumericMention(
        searchableText,
        /\b([\d,]+)\s+(?:points?|miles?)\b/gi,
      );
      const qualifyingSignalCount =
        (largestDollarAmount !== null && largestDollarAmount >= 500 ? 1 : 0) +
        (largestPointsOrMilesMention !== null &&
        largestPointsOrMilesMention >= 50_000
          ? 1
          : 0);
      return qualifyingSignalCount === 0
        ? []
        : [
            {
              ...post,
              derived: {
                ...post.derived,
                selectionSignals: {
                  largestDollarMention: largestDollarAmount,
                  largestPointsOrMilesMention,
                  qualifyingSignalCount,
                } satisfies SelectionSignals,
              },
            },
          ];
    })
    .sort(
      (left, right) =>
        right.derived.selectionSignals.qualifyingSignalCount -
          left.derived.selectionSignals.qualifyingSignalCount ||
        (right.derived.selectionSignals.largestDollarMention ?? 0) -
          (left.derived.selectionSignals.largestDollarMention ?? 0) ||
        (right.derived.selectionSignals.largestPointsOrMilesMention ?? 0) -
          (left.derived.selectionSignals.largestPointsOrMilesMention ?? 0) ||
        right.source.publishedAt.localeCompare(left.source.publishedAt) ||
        right.source.id - left.source.id,
    )
    .slice(0, limit);
}
