import { Field, Input, Select } from "@/components/ui/form";
import { TIMEZONES } from "@/lib/timezones";

interface Props {
  values?: Record<string, string | null | undefined>;
  errors?: Record<string, string[] | undefined>;
}

/** Country / timezone / currency inputs shared by signup, tenant and property forms. */
export function LocationFields({ values = {}, errors = {} }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Country" name="country" error={errors.country} hint="2-letter code, e.g. IN">
        <Input name="country" maxLength={2} required defaultValue={values.country ?? "IN"} invalid={!!errors.country} />
      </Field>
      <Field label="Timezone" name="timezone" error={errors.timezone}>
        <Select name="timezone" required defaultValue={values.timezone ?? "Asia/Kolkata"} invalid={!!errors.timezone}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Currency" name="currency" error={errors.currency} hint="ISO code, e.g. INR">
        <Input name="currency" maxLength={3} required defaultValue={values.currency ?? "INR"} invalid={!!errors.currency} />
      </Field>
    </div>
  );
}
