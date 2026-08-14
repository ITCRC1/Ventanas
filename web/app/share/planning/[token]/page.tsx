"use client";

import { PublicPlanning } from "@/components/PublicPlanning";
import { useParams } from "next/navigation";

export default function SharedPlanningPage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  return <PublicPlanning token={token} />;
}
