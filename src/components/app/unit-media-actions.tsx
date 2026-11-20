import { useState } from "react";
import { ImagePlus, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { brochureHtml } from "@/lib/brochure";
import { brochureFileName, downloadPdf, generateBrochurePdf } from "@/lib/brochure-pdf";

const db = supabase as any;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
export function UnitMediaActions({
  unit,
  workspaceId,
  company,
  agent,
  agentPhone,
}: {
  unit: {
    id: string;
    unit_code: string;
    area: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    price: number | null;
    payment_plan: string | null;
    project?: { name: string } | null;
  };
  workspaceId: string;
  company: string;
  agent: string;
  agentPhone: string;
}) {
  const { t, lang, dir } = useI18n();
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024 || !allowed.has(file.type))
          throw new Error("invalid_image");
        const path = `${workspaceId}/${unit.id}/${crypto.randomUUID()}`;
        const { error } = await supabase.storage
          .from("unit-media")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        const result = await db.from("unit_photos").insert({
          workspace_id: workspaceId,
          property_id: unit.id,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
        });
        if (result.error) throw result.error;
      }
      toast.success(t("photosUploaded"));
    } catch {
      toast.error(t("photoUploadFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function photoUrls(): Promise<string[] | null> {
    const { data, error } = await db
      .from("unit_photos")
      .select("storage_path")
      .eq("workspace_id", workspaceId)
      .eq("property_id", unit.id)
      .limit(8);
    if (error) return null;
    const urls = await Promise.all(
      (data ?? []).map(async (photo: { storage_path: string }) => {
        const result = await supabase.storage
          .from("unit-media")
          .createSignedUrl(photo.storage_path, 3600);
        return result.data?.signedUrl ?? "";
      }),
    );
    return urls.filter(Boolean);
  }
  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const urls = await photoUrls();
      if (urls === null) {
        toast.error(t("somethingWrong"));
        return;
      }
      const brochureUnit = {
        ...unit,
        project: unit.project?.name ?? "",
        photos: urls,
        company,
        agent,
        agentPhone,
      };
      // Real PDF bytes first: if generation fails, nothing is logged and
      // no WhatsApp window is opened.
      const bytes = await generateBrochurePdf([brochureUnit], lang);
      downloadPdf(bytes, brochureFileName([brochureUnit]));
      toast.success(dir === "rtl" ? "تم تنزيل الكتيب" : "Brochure downloaded");
      const body = `${company} · ${unit.project?.name ?? ""} · ${unit.unit_code} · ${unit.price ?? ""} EGP`;
      const wa = window.open(
        `https://wa.me/?text=${encodeURIComponent(body)}`,
        "_blank",
        "noopener,noreferrer",
      );
      if (!wa) {
        toast.error(t("popupBlocked"));
        return;
      }
      // Log only now that the PDF was actually generated and the share
      // was opened. The old code logged status "prepared" before anything
      // was produced; the table default is "sent", which is what this is.
      const logged = await db.from("whatsapp_messages").insert({
        workspace_id: workspaceId,
        agent_id: (await supabase.auth.getUser()).data.user?.id ?? null,
        body,
        status: "sent",
      });
      if (logged.error) toast.error(t("shareLogFailed"));
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setBusy(false);
    }
  }
  // Secondary option only: the HTML print view (no auto-print any more).
  async function printView() {
    if (busy) return;
    setBusy(true);
    try {
      const urls = await photoUrls();
      if (urls === null) {
        toast.error(t("somethingWrong"));
        return;
      }
      const html = brochureHtml(
        [
          {
            ...unit,
            project: unit.project?.name ?? "",
            photos: urls,
            company,
            agent,
            agentPhone,
          },
        ],
        lang,
      );
      const win = window.open("", "_blank");
      if (!win) {
        toast.error(t("popupBlocked"));
        return;
      }
      win.document.write(html);
      win.document.close();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <label className="inline-flex cursor-pointer">
        <input
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy}
          onChange={(e) => void upload(e.target.files)}
        />
        <span className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
          <ImagePlus className="size-4" />
          {t(busy ? "saving" : "unitPhotos")}
        </span>
      </label>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void share()}>
        <Share2 className="size-4" />
        {t("shareBrochure")}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void printView()}>
        {dir === "rtl" ? "عرض الطباعة" : "Print view"}
      </Button>
    </div>
  );
}
