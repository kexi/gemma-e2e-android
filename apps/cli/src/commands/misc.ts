import { parseCommand, rejectExtraOperands } from "../args.ts";
import { type Context, printJson } from "../context.ts";
import { EXIT_OK, type ExitCode } from "../exit-codes.ts";
import { renderDevice, renderModels } from "../render.ts";
import { answerHelpOrVersion, helpText, PROGRAM } from "../usage.ts";

const MODELS_HELP = helpText({
  usage: [`${PROGRAM} models [OPTION]...`],
  description:
    "List the models the configured LLM endpoint serves.\n\nEmbedding models are filtered out by the server: they cannot decide an\naction, so offering one would only produce a failed run.",
});

const DEVICE_HELP = helpText({
  usage: [`${PROGRAM} device [OPTION]...`],
  description: "Show the connected emulator's boot state, uptime, and hardware configuration.",
});

export async function modelsCommand(argv: string[], context: Context): Promise<ExitCode> {
  const parsed = parseCommand(argv, {}, ["models"]);
  answerHelpOrVersion(parsed.flags, MODELS_HELP);
  rejectExtraOperands(parsed.operands, 0, ["models"]);

  const { models } = await context.client.listModels();

  if (context.json) {
    printJson(context, models);
    return EXIT_OK;
  }

  context.out(renderModels(models));
  return EXIT_OK;
}

export async function deviceCommand(argv: string[], context: Context): Promise<ExitCode> {
  const parsed = parseCommand(argv, {}, ["device"]);
  answerHelpOrVersion(parsed.flags, DEVICE_HELP);
  rejectExtraOperands(parsed.operands, 0, ["device"]);

  const { device } = await context.client.getDevice();

  if (context.json) {
    printJson(context, device);
    return EXIT_OK;
  }

  context.out(renderDevice(device, context.style));
  return EXIT_OK;
}
