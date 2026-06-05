import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { renderToolUseProgressMessage } from './UI.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  TaskPrioritySchema,
  TaskStatusSchema,
} from '../../utils/tasks.js'
import { TASK_LIST_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    status: TaskStatusSchema()
      .optional()
      .describe('Filter by status: pending, in_progress, or completed'),
    owner: z
      .string()
      .optional()
      .describe('Filter by owner agent name'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        status: TaskStatusSchema(),
        priority: TaskPrioritySchema().optional(),
        owner: z.string().optional(),
        blockedBy: z.array(z.string()),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskListTool = buildTool({
  name: TASK_LIST_TOOL_NAME,
  searchHint: 'list all tasks',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskList'
  },
  shouldDefer: true,
  isEnabled() {
    return isTodoV2Enabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i?.status) return `Tasks: ${i.status}`
    if (i?.owner) return `Tasks by: ${i.owner}`
    return null
  },
  renderToolUseProgressMessage,
  renderToolUseMessage() {
    return null
  },
  async call({ status: statusFilter, owner: ownerFilter }) {
    const taskListId = getTaskListId()

    const allTasks = (await listTasks(taskListId)).filter(
      t => !t.metadata?._internal,
    )

    // Build a set of resolved task IDs for filtering out completed blockers
    const resolvedTaskIds = new Set(
      allTasks.filter(t => t.status === 'completed').map(t => t.id),
    )

    let tasks = allTasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      priority: task.priority,
      owner: task.owner,
      blockedBy: task.blockedBy.filter(id => !resolvedTaskIds.has(id)),
    }))

    // Apply optional filters
    if (statusFilter !== undefined) {
      tasks = tasks.filter(t => t.status === statusFilter)
    }
    if (ownerFilter !== undefined) {
      tasks = tasks.filter(t => t.owner === ownerFilter)
    }

    // Sort by numeric ID ascending (deterministic across OSes)
    tasks.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))

    return { data: { tasks } }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { tasks } = content as Output
    if (tasks.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No tasks found',
      }
    }

    const PRIORITY_PREFIX: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    }

    const lines = tasks.map(task => {
      const prio = task.priority ? ` ${PRIORITY_PREFIX[task.priority] ?? task.priority}` : ''
      const owner = task.owner ? ` (${task.owner})` : ''
      const blocked =
        task.blockedBy.length > 0
          ? ` [blocked by ${task.blockedBy.map(id => `#${id}`).join(', ')}]`
          : ''
      return `#${task.id} [${task.status}]${prio} ${task.subject}${owner}${blocked}`
    })

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
