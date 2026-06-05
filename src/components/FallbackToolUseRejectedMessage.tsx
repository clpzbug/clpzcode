import { InterruptedByUser } from './InterruptedByUser.js';
import { MessageResponse } from './MessageResponse.js';
export function FallbackToolUseRejectedMessage() {
  return <MessageResponse height={1}><InterruptedByUser /></MessageResponse>;
}
