"use client";

import { PublicPackage } from "@/components/PublicPackage";
import { useParams } from "next/navigation";

export default function SharedPackagePage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  return <PublicPackage token={token} />;
}
