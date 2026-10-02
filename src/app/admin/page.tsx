import type { Metadata } from "next";
import { AdminApp } from "@/admin/AdminApp";

export const metadata: Metadata = { title: "Kiosk admin" };

// All data is fetched client-side from PIN-protected API routes, which authorize every
// request themselves. This page itself contains no data.
export default function AdminPage() {
  return <AdminApp />;
}
