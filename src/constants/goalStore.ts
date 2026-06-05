let activeGoal: string | undefined = undefined

export function setActiveGoal(goal: string | undefined): void {
  activeGoal = goal
}

export function getActiveGoal(): string | undefined {
  return activeGoal
}

export function getGoalSystemSection(): string | null {
  if (!activeGoal) return null
  return `# Active Goal\n${activeGoal}`
}
