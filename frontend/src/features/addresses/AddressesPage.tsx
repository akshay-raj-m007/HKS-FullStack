import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin, Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { api } from "../../api/client";
import type { Address } from "../../types";
import { addressSchema, AddressInput } from "../../schemas/forms";
import { useAuth } from "../auth/AuthContext";
import { useLocation } from "react-router-dom";
import { appPath, type NavigationState } from "../../routes/navigation";
import {
  PageHeading,
  ErrorMessage,
  Loading,
  Empty,
  BackLink,
} from "../../components/ui";
const blank = {
  label: "Home",
  contactName: "",
  contactPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "",
};
export function AddressesPage() {
  const { user } = useAuth(),
    client = useQueryClient();
  const contactPhone =
    import.meta.env.VITE_PUBLIC_DEMO_MODE === "true"
      ? "+919876543210"
      : (user?.phone ?? "");
  const location = useLocation();
  const backTo = (location.state as NavigationState | null)?.backTo;
  const [editing, setEditing] = useState<Address | null>(null),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api<Address[]>("/addresses"),
  });
  const form = useForm<AddressInput>({
    resolver: zodResolver(addressSchema),
    defaultValues: { ...blank, contactPhone },
  });
  const save = useMutation({
    mutationFn: (data: AddressInput) =>
      api<Address>(editing ? "/addresses/" + editing.id : "/addresses", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["addresses"] });
      setOpen(false);
      setNotice("Your pickup address has been saved.");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api("/addresses/" + id, { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["addresses"] });
      setDeleteId(null);
      setNotice("Address removed.");
    },
  });
  const busy = save.isPending || remove.isPending;
  function start(address: Address | null) {
    setEditing(address);
    save.reset();
    remove.reset();
    setDeleteId(null);
    setNotice("");
    if (address) {
      const { id: _id, ...values } = address;
      form.reset(values);
    } else form.reset({ ...blank, contactPhone });
    setOpen(true);
  }
  const fields: {
    key: keyof AddressInput;
    label: string;
    placeholder?: string;
    wide?: boolean;
  }[] = [
    {
      key: "label",
      label: "Address label",
      placeholder: "Home, work, or somewhere else",
    },
    { key: "contactName", label: "Contact name" },
    {
      key: "contactPhone",
      label: "Contact mobile number",
      placeholder: "+91 98765 43210",
    },
    { key: "postalCode", label: "Postal code", placeholder: "560001" },
    {
      key: "addressLine1",
      label: "Street address",
      placeholder: "House / apartment and street",
      wide: true,
    },
    {
      key: "addressLine2",
      label: "Apartment, landmark (optional)",
      wide: true,
    },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
  ];
  return (
    <>
      {backTo && (
        <BackLink to={appPath(backTo)} children="Back to your pickup" />
      )}
      <PageHeading
        eyebrow="YOUR PICKUP PLACES"
        title="Good things happen at home."
        description="Save a few locations. Choose the right one for each pickup."
      >
        <button className="button" disabled={busy} onClick={() => start(null)}>
          <Plus size={17} />
          Add address
        </button>
      </PageHeading>
      {notice && (
        <div className="success-note" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      <ErrorMessage error={query.error || remove.error} />
      {open && (
        <section className="panel address-editor">
          <div className="section-heading">
            <h2>{editing ? "Edit address" : "A new pickup place"}</h2>
            <button
              className="icon-button"
              aria-label="Close address form"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <ErrorMessage error={save.error} />
          <form
            onSubmit={form.handleSubmit((data) => save.mutate(data))}
            noValidate
          >
            <div className="form-grid">
              {fields.map((f) => (
                <div key={f.key} className={f.wide ? "span-two" : ""}>
                  <label htmlFor={f.key}>{f.label}</label>
                  <input
                    id={f.key}
                    placeholder={f.placeholder}
                    type={f.key === "contactPhone" ? "tel" : "text"}
                    {...form.register(f.key)}
                    aria-invalid={!!form.formState.errors[f.key]}
                    disabled={busy}
                  />
                  {form.formState.errors[f.key] && (
                    <p className="field-error">
                      {form.formState.errors[f.key]?.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="button" disabled={busy}>
                {save.isPending ? "Saving…" : "Save address"}
                <Check size={17} />
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.data?.length ? (
        <div className="address-grid">
          {query.data.map((a) => (
            <article className="panel address-card" key={a.id}>
              <span className="address-icon">
                <MapPin size={22} />
              </span>
              <h2>{a.label}</h2>
              <p>{a.contactName}</p>
              <p className="muted">
                {a.addressLine1}
                <br />
                {a.addressLine2 && (
                  <>
                    {a.addressLine2}
                    <br />
                  </>
                )}
                {a.city}, {a.state} {a.postalCode}
              </p>
              <p className="muted">{a.contactPhone}</p>
              {deleteId === a.id ? (
                <div className="delete-confirm">
                  <p>Remove this saved address?</p>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => remove.mutate(a.id)}
                  >
                    Yes, remove
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setDeleteId(null)}
                  >
                    Keep address
                  </button>
                </div>
              ) : (
                <div className="address-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => start(a)}
                  >
                    <Pencil size={15} />
                    Edit
                  </button>
                  <button
                    className="text-button muted"
                    disabled={busy}
                    onClick={() => {
                      remove.reset();
                      setDeleteId(a.id);
                    }}
                  >
                    <Trash2 size={15} />
                    Remove
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        !query.error &&
        !open && (
          <Empty title="Where should we stop by?">
            <p>Add your first address to start booking pickups.</p>
            <button className="button" onClick={() => start(null)}>
              Add your first address
            </button>
          </Empty>
        )
      )}
      <p className="support-note">
        Demo service areas: Bengaluru 560001, 560034, 560038 · Mysuru 570001.
        Provider coverage varies.
      </p>
    </>
  );
}
