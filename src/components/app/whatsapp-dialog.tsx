import { useEffect, useState } from "react";
import { ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import type { Lead } from "@/lib/leads";
import { normalizePhone, whatsappUrl } from "@/lib/phone";
import { supabase } from "@/integrations/supabase/client";

type LeadLike = Pick<Lead, "id" | "full_name" | "phone" | "interested_project">;

export function WhatsAppDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadLike;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const ws = useWorkspaceData();
  const [phone, setPhone] = useState(lead.phone);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setPhone(lead.phone);
    const firstName =
      lead.full_name
        .replace(/\s*\(.*?\)\s*/g, " ")
        .trim()
        .split(/\s+/)[0] ?? lead.full_name;
    setMessage(
      t("waDefaultMessage", {
        name: firstName,
        agent: ws.profile.full_name || "",
        agency: ws.workspace.name,
        project: lead.interested_project
          ? t("waProjectPart", { project: lead.interested_project })
          : "",
      }).replace(/\s{2,}/g, " "),
    );
  }, [open, lead, t, ws.profile.full_name, ws.workspace.name]);

  const check = normalizePhone(phone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle aria-hidden="true" className="h-5 w-5 text-whatsapp" />
            {t("waTitle")}
          </DialogTitle>
          <DialogDescription>{t("waBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="wa-phone">{t("waNumber")}</Label>
            <Input
              id="wa-phone"
              dir="ltr"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={!check.ok || undefined}
              aria-describedby="wa-phone-help"
              className="mt-1.5 text-start"
            />
            <p
              id="wa-phone-help"
              className={
                check.ok ? "mt-1 text-xs text-muted-foreground" : "mt-1 text-xs text-destructive"
              }
            >
              {check.ok ? (
                <span className="ltr-nums">wa.me/{check.digits}</span>
              ) : (
                t(check.error === "eg_mobile" ? "phoneEgMobileInvalid" : "phoneInvalid")
              )}
            </p>
          </div>
          <div>
            <Label htmlFor="wa-message">{t("waMessage")}</Label>
            <Textarea
              id="wa-message"
              rows={5}
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1.5"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant="whatsapp" disabled={!check.ok} asChild={check.ok}>
            {check.ok ? (
              <a
                href={whatsappUrl(check.digits, message)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  void (supabase as any).from("lead_activities").insert({
                    lead_id: lead.id,
                    workspace_id: ws.workspace.id,
                    activity_type: "lead.response_whatsapp",
                  });
                  onOpenChange(false);
                }}
              >
                <ExternalLink aria-hidden="true" />
                {t("waOpen")}
              </a>
            ) : (
              <span>{t("waOpen")}</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
