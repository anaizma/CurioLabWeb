import ReviewClient from "./review-client";

export default async function ReviewTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ReviewClient token={token} />;
}
