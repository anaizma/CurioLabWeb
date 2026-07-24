import { getStudentProfile } from "@/lib/portal/student-data";
import ProfileHero from "@/components/portal/profile/ProfileHero";
import ProfileIntro from "@/components/portal/profile/ProfileIntro";
import PinnedProjects from "@/components/portal/profile/PinnedProjects";
import Composer from "@/components/portal/profile/Composer";
import ActivityFeed from "@/components/portal/profile/ActivityFeed";

export default async function StudentProfilePage() {
  const p = await getStudentProfile();
  return (
    <div className="mx-auto max-w-3xl px-6 py-6 pb-20 space-y-3.5">
      {p.isSample && (
        <div className="text-xs font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">
          Sample data — sign in as a student to see a real profile.
        </div>
      )}
      <ProfileHero p={p} />
      <ProfileIntro p={p} />
      <PinnedProjects p={p} />
      <Composer p={p} />
      <div className="pt-4">
        <ActivityFeed p={p} />
      </div>
    </div>
  );
}
