import { Button } from "./button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "./dialog";

export function KeyboardHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">Keyboard help</Button>
      </DialogTrigger>
      <DialogContent title="Keyboard help" description="Move through the office without a pointer.">
        <ul className="list-disc space-y-2 pl-5 text-base leading-relaxed">
          <li>Tab moves between the skip link, the navigation, and this button.</li>
          <li>Arrow keys move between navigation links. Home and End jump to the ends.</li>
          <li>On a job, Move changes the stage. Lost asks for a reason before it saves.</li>
          <li>Arrow keys move between a job's tabs. Escape closes this dialog.</li>
        </ul>
        <DialogClose asChild>
          <Button className="mt-4" variant="primary">
            Close
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
