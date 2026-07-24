import { getStudentProfile } from "@/lib/portal/student-data";
import ProfileHero from "@/components/portal/profile/ProfileHero";
import SkillsCard from "@/components/portal/profile/SkillsCard";
import ProfileIntro from "@/components/portal/profile/ProfileIntro";
import PinnedProjects from "@/components/portal/profile/PinnedProjects";
import Composer from "@/components/portal/profile/Composer";
import ActivityFeed from "@/components/portal/profile/ActivityFeed";

export default async function StudentProfilePage() {
  const p = await getStudentProfile();
  return (
    <div className="mx-auto max-w-[1500px] px-5 py-5">
      {p.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2 mb-4">
          Sample data — sign in as a student to see a real profile.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)_330px] gap-5 items-start">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <ProfileHero p={p} />
          <SkillsCard p={p} />
        </aside>
        <main className="flex flex-col gap-4 min-w-0">
          <Composer p={p} />
          <ActivityFeed p={p} />
        </main>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <ProfileIntro p={p} />
          <PinnedProjects p={p} />
        </aside>
      </div>
    </div>
  );
}
