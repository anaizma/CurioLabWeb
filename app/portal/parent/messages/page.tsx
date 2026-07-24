import { getGuardianMessages } from "@/lib/portal/guardian/messages-data";
import SampleBanner from "@/components/portal/SampleBanner";
import MessagesClient from "./messages-client";

export default async function GuardianMessagesPage() {
  const v = await getGuardianMessages();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-ink/60 text-sm mt-1">
          Message your chapter&apos;s mentors and director directly. Every message is kept on the record, like email.
        </p>
      </div>
      {v.isSample && <SampleBanner />}
      <MessagesClient seed={v.messages} threadId={v.threadId} live={v.live} />
    </div>
  );
}
