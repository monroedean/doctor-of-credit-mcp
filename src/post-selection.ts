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
