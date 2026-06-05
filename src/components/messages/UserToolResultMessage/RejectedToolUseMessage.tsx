import { Text } from '../../../ink.js';
import { MessageResponse } from '../../MessageResponse.js';
export function RejectedToolUseMessage() {
  return <MessageResponse height={1}><Text dimColor={true}>Tool use rejected</Text></MessageResponse>;
}
