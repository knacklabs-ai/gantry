export function serializeQuestionSelections(
  selections: Map<number, Set<number>>,
): Array<{ questionIndex: number; optionIndexes: number[] }> {
  return [...selections.entries()]
    .sort(([a], [b]) => a - b)
    .map(([questionIndex, optionIndexes]) => ({
      questionIndex,
      optionIndexes: [...optionIndexes].sort((a, b) => a - b),
    }));
}
