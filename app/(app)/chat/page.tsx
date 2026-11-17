import { requireOwner } from "@/lib/session";
import ChatClient from "../../_components/ChatClient";

export default async function Chat() {
  await requireOwner();
  return (
    <>
      <h1>Chocks</h1>
      <p className="muted small">Your assistant for adding photos and aircraft details. Nothing is saved until you confirm.</p>
      <ChatClient />
    </>
  );
}
