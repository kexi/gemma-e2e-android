import { useId } from "react";
import { PERSONA_PRESETS, type Persona, type PersonaReviewSettings } from "@gemma-e2e/core/schema";
import { useI18n } from "./I18nProvider.tsx";

/** The schema's cap, named once so the check and the sentence that states it agree. */
const MAX_PERSONAS = 8;

interface Props {
  value: PersonaReviewSettings | undefined;
  onChange: (value: PersonaReviewSettings | undefined) => void;
  inherited?: PersonaReviewSettings | undefined;
  allowInherit?: boolean;
}

export function PersonaReviewSettingsEditor({
  value,
  onChange,
  inherited,
  allowInherit = false,
}: Props) {
  const id = useId();
  const { t } = useI18n();
  const isInherited = allowInherit && value === undefined;
  const personas = value?.personas ?? [];
  const isFull = personas.length >= MAX_PERSONAS;

  function updatePersona(personaId: string, patch: Partial<Persona>) {
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
      <legend>{t.reviewSettings.legend}</legend>
      <p className="builder-hint">{t.reviewSettings.intro}</p>
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
          {t.reviewSettings.useScenarioPersonas(inherited?.personas.length ?? 0)}
        </label>
      )}
      {isInherited ? (
        <p className="builder-hint">
          {inherited?.personas.map((persona) => persona.label).join(" · ") ||
            t.reviewSettings.offInScenario}
        </p>
      ) : (
        <>
          <p className="builder-hint">{t.reviewSettings.chooseUpTo(MAX_PERSONAS)}</p>
          {PERSONA_PRESETS.map((preset) => {
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
              <legend>{persona.label || t.reviewSettings.customPersona}</legend>
              <div className="builder-field">
                <label htmlFor={`${id}-${persona.id}-label`}>{t.reviewSettings.personaName}</label>
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
                  {t.reviewSettings.personaDescription}
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
                aria-label={t.reviewSettings.removePersonaLabel(persona.label || persona.id)}
                onClick={() =>
                  onChange({ personas: personas.filter((item) => item.id !== persona.id) })
                }
              >
                {t.reviewSettings.removePersona}
              </button>
            </fieldset>
          ))}
          <button type="button" className="builder-add" disabled={isFull} onClick={addCustom}>
            {t.reviewSettings.addCustomPersona}
          </button>
        </>
      )}
    </fieldset>
  );
}
