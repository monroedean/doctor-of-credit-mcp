interface SelectablePost {
  source: {
    id: number;
    url: string;
    title: string;
    publishedAt: string;
    modifiedAt: string | null;
    articleText: string;
  };
  derived: {
    outdatedWarning: string | null;
  };
}

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

function largestMatch(text: string, pattern: RegExp): number | null {
  const values = [...text.matchAll(pattern)].flatMap((match) => {
    const rawValue = match[1];
    if (rawValue === undefined) {
      return [];
    }
    const value = Number(rawValue.replaceAll(",", ""));
    return Number.isFinite(value) ? [value] : [];
  });
  return values.length === 0 ? null : Math.max(...values);
}

export function selectBigDeals(
  posts: SelectablePost[],
  limit: number,
): BigDealPost[] {
  return posts
    .flatMap((post) => {
      const searchableText = `${post.source.title}\n${post.source.articleText}`;
      const largestDollarMention = largestMatch(
        searchableText,
        /\$\s*([\d,]+(?:\.\d{1,2})?)/g,
      );
      const largestPointsOrMilesMention = largestMatch(
        searchableText,
        /\b([\d,]+)\s+(?:points?|miles?)\b/gi,
      );
      const qualifyingSignalCount =
        (largestDollarMention !== null && largestDollarMention >= 500 ? 1 : 0) +
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
                  largestDollarMention,
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
