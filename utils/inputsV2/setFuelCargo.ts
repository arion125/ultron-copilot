import inquirer from 'inquirer';

export const setLoadFuel = async (endText: boolean) => {
  return inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: `Use the fuel cargo to load fuel ${endText}:`,
      default: false
    }
  ]);
};

