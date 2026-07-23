import ParentClient from "./parent-client";

export default async function ParentTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ParentClient token={token} />;
}
