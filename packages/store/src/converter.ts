import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  WithFieldValue,
} from "firebase-admin/firestore";
import type { z } from "zod";

export class ConverterError extends Error {
  override readonly name = "ConverterError";
}

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

/**
 * Turns a Zod schema into a Firestore converter that validates in *both*
 * directions.
 *
 * Why parse on write as well as read: Firestore is schemaless, so a field the
 * type system believes exists is only actually guaranteed by a runtime check.
 * Validating on the way in means a malformed document can never be created,
 * which is what lets the read side treat a validation failure as genuine
 * corruption rather than a routine occurrence.
 *
 * Why the output of the write parse is what gets stored: Zod strips unknown
 * keys and applies defaults, so the document on disk matches the schema exactly
 * instead of carrying whatever extra properties the caller's object happened to
 * have.
 */
export function zodConverter<Schema extends z.ZodType<object, z.ZodTypeDef, object>>(
  schema: Schema,
  label: string,
): FirestoreDataConverter<z.output<Schema>> {
  return {
    toFirestore(value: WithFieldValue<z.output<Schema>>): DocumentData {
      const result = schema.safeParse(value);
      if (!result.success) {
        throw new ConverterError(`cannot write an invalid ${label}: ${describe(result.error)}`);
      }
      return result.data as DocumentData;
    },

    fromFirestore(snapshot: QueryDocumentSnapshot): z.output<Schema> {
      const result = schema.safeParse(snapshot.data());
      if (!result.success) {
        throw new ConverterError(
          `${label} ${snapshot.ref.path} does not match its schema: ${describe(result.error)}`,
        );
      }
      return result.data;
    },
  };
}
