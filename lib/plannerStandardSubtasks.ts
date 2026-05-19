/** Matches PlannerTaskModal standard subtask IDs (shared server/client). */
export const STD_PREPARE_ID = "std-prepare";
export const STD_TODO_ID = "std-todo";
export const STD_COMPLETED_ID = "std-completed";

export type PlannerSubTaskJson = {
  id: string;
  title: string;
  isCompleted: boolean;
  isStandard: boolean;
};

export function createStandardPlannerSubtasksJson(taskTitle: string): PlannerSubTaskJson[] {
  const baseTitle = taskTitle.trim() || "Untitled Task";
  return [
    { id: STD_PREPARE_ID, title: "Prepare", isCompleted: false, isStandard: true },
    { id: STD_TODO_ID, title: `To-Do: ${baseTitle}`, isCompleted: false, isStandard: true },
    { id: STD_COMPLETED_ID, title: "Completed", isCompleted: false, isStandard: true },
  ];
}
