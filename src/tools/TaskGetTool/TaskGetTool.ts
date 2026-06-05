import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { renderToolUseProgressMessage } from './UI.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getTask,
  getTaskListId,
  isTodoV2Enabled,
  TaskPrioritySchema,
  TaskStatusSchema,
} from '../../utils/tasks.js'
import { TASK_GET_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().describe('The ID of the task to retrieve'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task: z
      .object({
        id: z.string(),
        subject: z.string(),
        description: z.string(),
        status: TaskStatusSchema(),
        priority: TaskPrioritySchema().optional(),
        activeForm: z.string().optional(),
        owner: z.string().optional(),
        blocks: z.array(z.string()),
        blockedBy: z.array(z.string()),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .nullable(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskGetTool = buildTool({
  name: TASK_GET_TOOL_NAME,
  searchHint: 'retrieve a task by ID',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskGet'
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
  toAutoClassifierInput(input) {
    return input.taskId
  },
  getActivityDescription(input) {
    return input?.taskId ? `Getting task: ${input.taskId}` : 'Getting task'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage() {
    return null
  },
  async call({ taskId }) {
    const taskListId = getTaskListId()

    const task = await getTask(taskListId, taskId)

    if (!task) {
      return {
        data: {
          task: null,
        },
      }
    }

    return {
      data: {
        task: {
          id: task.id,
          subject: task.subject,
          description: task.description,
          status: task.status,
          priority: task.priority,
          activeForm: task.activeForm,
          owner: task.owner,
          blocks: task.blocks,
          blockedBy: task.blockedBy,
          metadata: task.metadata,
        },
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output
    if (!task) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'Task not found',
      }
    }

    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}${task.priority ? ` | Priority: ${task.priority}` : ''}`,
      `Description: ${task.description}`,
    ]

    if (task.owner) lines.push(`Owner: ${task.owner}`)
    if (task.activeForm) lines.push(`Active form: ${task.activeForm}`)
    if (task.blockedBy.length > 0) {
      lines.push(`Blocked by: ${task.blockedBy.map(id => `#${id}`).join(', ')}`)
    }
    if (task.blocks.length > 0) {
      lines.push(`Blocks: ${task.blocks.map(id => `#${id}`).join(', ')}`)
    }
    if (task.metadata && Object.keys(task.metadata).length > 0) {
      lines.push(`Metadata: ${JSON.stringify(task.metadata)}`)
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
