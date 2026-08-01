import {
  largestDollarMention,
  selectRecentCandidates,
  sourceTextFor,
  type SelectablePost,
} from "./post-selection.js";

export interface BankBonusFilters {
  bank?: string;
  state?: { code: string; name: string };
  amountMinimum?: number;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

export function stateNameFor(code: string): string | undefined {
  return STATE_NAMES[code];
}

export function selectBankBonuses(
  posts: SelectablePost[],
  filters: BankBonusFilters,
) {
  return selectRecentCandidates(posts, (post) => {
    const sourceText = sourceTextFor(post);
    const bonusTermMatched = /\bbonus(?:es)?\b/i.test(sourceText);
    const bankingTermMatched =
      /\b(?:banks?|banking|checking|savings|credit unions?|deposit accounts?)\b/i.test(
        sourceText,
      );
    const largestAmount = largestDollarMention(sourceText);
    const bankMatch =
      filters.bank === undefined
        ? null
        : sourceText
            .toLocaleLowerCase()
            .includes(filters.bank.toLocaleLowerCase());
    const stateMatch =
      filters.state === undefined
        ? null
        : new RegExp(`\\b${filters.state.name}\\b`, "i").test(sourceText) ||
          new RegExp(`\\b${filters.state.code}\\b`).test(sourceText);
    const amountMinimumMatch =
      filters.amountMinimum === undefined
        ? null
        : largestAmount !== null && largestAmount >= filters.amountMinimum;

    if (
      !bonusTermMatched ||
      !bankingTermMatched ||
      bankMatch === false ||
      stateMatch === false ||
      amountMinimumMatch === false
    ) {
      return null;
    }

    return {
      ...post,
      derived: {
        ...post.derived,
        bankBonusSignals: {
          bonusTermMatched,
          bankingTermMatched,
          largestDollarMention: largestAmount,
          bankMatch,
          stateMatch,
          amountMinimumMatch,
        },
      },
    };
  });
}
