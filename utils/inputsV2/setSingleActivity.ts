import inquirer from "inquirer";
import { singleActivites } from "../../common/constants";

export const setSingleActivity = async (): Promise<string> => {
  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "activity",
      message: "Choose which SINGLE activity you want to start:",
      choices: singleActivites,
    },
  ]);

  const activity = answer.activity;

  return activity;
};
