import StudentClient from "./student-client";

export default async function StudentTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <StudentClient token={token} />;
}
