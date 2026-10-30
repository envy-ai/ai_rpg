'use strict';
// One canonical protagonist construction/init path shared by new-game and existing-world setup.
class RuntimeProtagonistSetup {
 static shouldResumeInitialization(player,stages){return stages.protagonistConstructed===player.id&&(!stages.abilitiesReady||!stages.techniquesReady);}
 constructor(scope){this.scope=scope;}
 create(fields){const s=this.scope;const options={name:fields.playerName,description:fields.playerDescription,class:fields.playerClass,race:fields.playerRace,level:fields.playerLevel,currency:fields.startingCurrency,attributes:fields.attributes||{strength:10,dexterity:10,constitution:10,intelligence:10,wisdom:10,charisma:10}};for(const key of ['skills','personalityType','personalityTraits','personalityNotes','goals'])if(Object.hasOwn(fields,key))options[key]=fields[key];const p=new s.Player(options);p.syncSkillsWithAvailable?.();return p;}
 async initialize(player,location,region,{stages={},record=async()=>{},standings=true}={}){const s=this.scope;if(standings&&!stages.standingsReady){await s.generateInitialFactionStandings({player,factions:s.factions});await record('standingsReady');}if(!stages.inventoryReady){await s.generateInventoryForCharacter({character:player,characterDescriptor:{role:'adventurer',class:player.class,race:player.race},region,location});await record('inventoryReady');}const choices=await s.resolvePlayerAbilitySelectionState(player,{ensureOptionsForNext:true});if(!stages.abilitiesReady)await record('abilitiesReady');if(!stages.techniquesReady){await s.generateStartingTechniques({actors:[player],config:s.config,setting:s.getActiveSettingSnapshot(),location});await record('techniquesReady');}return choices;}
}
module.exports=RuntimeProtagonistSetup;
