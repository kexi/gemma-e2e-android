import { useId } from "react";
import {
  ACCESSIBILITY_PERSONA_PRESETS,
  type AccessibilityPersona,
  type AccessibilitySettings,
} from "@gemma-e2e/core/schema";

interface Props {
  value: AccessibilitySettings | undefined;
  onChange: (value: AccessibilitySettings | undefined) => void;
  inherited?: AccessibilitySettings | undefined;
  allowInherit?: boolean;
}

export function AccessibilitySettingsEditor({
  value,
  onChange,
  inherited,
  allowInherit = false,
}: Props) {
  const id = useId();
  const isInherited = allowInherit && value === undefined;
  const personas = value?.personas ?? [];
  const isFull = personas.length >= 8;

  function updatePersona(personaId: string, patch: Partial<AccessibilityPersona>) {
    onChange({
      personas: personas.map((persona) =>
        persona.id === personaId ? { ...persona, ...patch } : persona,
      ),
    });
  }

  function addCustom() {
    let suffix = 1;
    while (personas.some((persona) => persona.id === `custom-${suffix}`)) {
      suffix += 1;
    }
    onChange({ personas: [...personas, { id: `custom-${suffix}`, label: "", description: "" }] });
  }

  return (
    <fieldset className="builder-fieldset">
      <legend>Visual accessibility review</legend>
      <p className="builder-hint">
        Review screenshots for each persona. Findings are suggestions, not a conformance
        certification. Screen reader behavior is outside this review.
      </p>
      {allowInherit && (
        <label className="builder-checkbox">
          <input
            type="checkbox"
            name={`${id}-inherit`}
            checked={isInherited}
            onChange={(event) =>
              onChange(
                event.target.checked ? undefined : { personas: [...(inherited?.personas ?? [])] },
              )
            }
          />
          Use scenario personas ({inherited?.personas.length ?? 0})
        </label>
      )}
      {isInherited ? (
        <p className="builder-hint">
          {inherited?.personas.map((persona) => persona.label).join(" · ") ||
            "Review is off in this scenario."}
        </p>
      ) : (
        <>
          <p className="builder-hint">Choose up to 8 personas. No selection turns review off.</p>
          {ACCESSIBILITY_PERSONA_PRESETS.map((preset) => {
            const selected = personas.some((persona) => persona.id === preset.id);
            return (
              <label key={preset.id} className="builder-checkbox">
                <input
                  type="checkbox"
                  name={`${id}-${preset.id}`}
                  checked={selected}
                  disabled={!selected && isFull}
                  onChange={(event) =>
                    onChange({
                      personas: event.target.checked
                        ? [...personas, { ...preset }]
                        : personas.filter((persona) => persona.id !== preset.id),
                    })
                  }
                />
                {preset.label}
              </label>
            );
          })}
          {personas.map((persona) => (
            <fieldset key={persona.id} className="builder-fieldset">
              <legend>{persona.label || "Custom persona"}</legend>
              <div className="builder-field">
                <label htmlFor={`${id}-${persona.id}-label`}>Persona name *</label>
                <input
                  id={`${id}-${persona.id}-label`}
                  name={`${id}-${persona.id}-label`}
                  value={persona.label}
                  required
                  maxLength={120}
                  onChange={(event) => updatePersona(persona.id, { label: event.target.value })}
                />
              </div>
              <div className="builder-field">
                <label htmlFor={`${id}-${persona.id}-description`}>
                  Viewing conditions and concerns *
                </label>
                <textarea
                  id={`${id}-${persona.id}-description`}
                  name={`${id}-${persona.id}-description`}
                  value={persona.description}
                  required
                  maxLength={2000}
                  rows={3}
                  onChange={(event) =>
                    updatePersona(persona.id, { description: event.target.value })
                  }
                />
              </div>
              <button
                type="button"
                className="builder-remove"
                aria-label={`Remove persona ${persona.label || persona.id}`}
                onClick={() =>
                  onChange({ personas: personas.filter((item) => item.id !== persona.id) })
                }
              >
                Remove persona
              </button>
            </fieldset>
          ))}
          <button type="button" className="builder-add" disabled={isFull} onClick={addCustom}>
            Add custom persona
          </button>
        </>
      )}
    </fieldset>
  );
}
