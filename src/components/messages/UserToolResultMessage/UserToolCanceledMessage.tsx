import { InterruptedByUser } from 'src/components/InterruptedByUser.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
export function UserToolCanceledMessage() {
  return <MessageResponse height={1}><InterruptedByUser /></MessageResponse>;
}
