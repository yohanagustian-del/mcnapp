"use server";

import { revalidatePath } from "next/cache";
import { uploadProductMasterList } from "@/lib/m10/products";
import type { UploadReport } from "@/app/(portal)/tim/actions";

/** Thin wrapper around the m10 parser so the upload form revalidates this page. */
export async function uploadMasterProducts(formData: FormData): Promise<UploadReport> {
  const report = await uploadProductMasterList(formData);
  revalidatePath("/products");
  return report;
}
