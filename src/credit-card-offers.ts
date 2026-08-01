import {
  largestDollarMention,
  largestNumericMention,
  selectRecentCandidates,
  sourceTextFor,
  type SelectablePost,
} from "./post-selection.js";

export interface CreditCardOfferFilters {
  issuer?: string;
  card?: string;
  bonusMinimum?: number;
}

export function selectCreditCardOffers(
  posts: SelectablePost[],
  filters: CreditCardOfferFilters,
) {
  return selectRecentCandidates(posts, (post) => {
    const sourceText = sourceTextFor(post);
    const creditCardTermMatched = /\bcredit[ -]cards?\b/i.test(sourceText);
    const offerTermMatched =
      /\b(?:bonus(?:es)?|offers?|welcome|sign[ -]up)\b/i.test(sourceText);
    const largestDollarAmount = largestDollarMention(sourceText);
    const largestPointsOrMilesMention = largestNumericMention(
      sourceText,
      /\b([\d,]+)\s+(?:points?|miles?)\b/gi,
    );
    const issuerMatch =
      filters.issuer === undefined
        ? null
        : sourceText
            .toLocaleLowerCase()
            .includes(filters.issuer.toLocaleLowerCase());
    const cardMatch =
      filters.card === undefined
        ? null
        : sourceText
            .toLocaleLowerCase()
            .includes(filters.card.toLocaleLowerCase());
    const bonusMinimumMatch =
      filters.bonusMinimum === undefined
        ? null
        : (largestDollarAmount !== null &&
            largestDollarAmount >= filters.bonusMinimum) ||
          (largestPointsOrMilesMention !== null &&
            largestPointsOrMilesMention >= filters.bonusMinimum);

    if (
      !creditCardTermMatched ||
      !offerTermMatched ||
      issuerMatch === false ||
      cardMatch === false ||
      bonusMinimumMatch === false
    ) {
      return null;
    }

    return {
      ...post,
      derived: {
        ...post.derived,
        creditCardOfferSignals: {
          creditCardTermMatched,
          offerTermMatched,
          largestDollarMention: largestDollarAmount,
          largestPointsOrMilesMention,
          issuerMatch,
          cardMatch,
          bonusMinimumMatch,
        },
      },
    };
  });
}
