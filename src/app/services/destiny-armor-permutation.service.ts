import {Injectable} from '@angular/core';
import {GearPermutation, Stats} from "../data/permutation";
import {IInventoryArmor} from "./IInventoryArmor";


@Injectable({
  providedIn: 'root'
})
export class DestinyArmorPermutationService {

  constructor() {
  }

  public buildPermutations(armor: IInventoryArmor[]): GearPermutation[] {
    let permutations: GearPermutation[] = []

    let helmets = armor.filter(s => s.slot == "Helmets");
    let gauntlets = armor.filter(s => s.slot == "Arms");
    let chests = armor.filter(s => s.slot == "Chest");
    let legs = armor.filter(s => s.slot == "Legs");


    for (let helmet of helmets) {
      for (let gauntlet of gauntlets) {
        if (helmet.isExotic && gauntlet.isExotic) continue;
        for (let chest of chests) {
          if ((helmet.isExotic || gauntlet.isExotic) && chest.isExotic) continue;
          for (let leg of legs) {
            if ((helmet.isExotic || gauntlet.isExotic || chest.isExotic) && leg.isExotic) continue;
            permutations.push(new GearPermutation(
              !!(helmet.isExotic || gauntlet.isExotic || chest.isExotic || leg.isExotic),
              helmet, gauntlet, chest, leg
            ))
          }
        }
      }
    }
    return permutations;
  }
}