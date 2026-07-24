import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import { getMailView } from "@/lib/portal/guardian/mail-data";
import MessagesClient from "./messages-client";

export default async function GuardianMessagesPage() {
  const [v, mail] = await Promise.all([getGuardianView(), getMailView()]);
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Messages</h1>
        <p className="text-muted text-[13px] mt-1">Write to your chapter&apos;s mentors and director, and see your child&apos;s chapter conversations. Everything is kept on the record.</p>
      </div>
      {mail.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian for your real inbox.</div>
      )}
      <MessagesClient view={mail} childName={v.child.displayName} />
    </div>
  );
}
