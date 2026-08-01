export interface SelectablePost {
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

export function largestNumericMention(
  text: string,
  pattern: RegExp,
): number | null {
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

export function largestDollarMention(text: string): number | null {
  return largestNumericMention(text, /\$\s*([\d,]+(?:\.\d{1,2})?)/g);
}

export function sourceTextFor(post: SelectablePost): string {
  return `${post.source.title}\n${post.source.articleText}`;
}

export function selectRecentCandidates<T extends SelectablePost>(
  posts: SelectablePost[],
  candidateFor: (post: SelectablePost) => T | null,
  limit = 10,
): T[] {
  return posts
    .flatMap((post) => {
      const candidate = candidateFor(post);
      return candidate === null ? [] : [candidate];
    })
    .sort(
      (left, right) =>
        right.source.publishedAt.localeCompare(left.source.publishedAt) ||
        right.source.id - left.source.id,
    )
    .slice(0, limit);
}
