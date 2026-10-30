'use strict';
// Reviewed drafts use canonical generators with durable stage identities. Runtime replacement
// occurs once; an explicit retry resumes this runtime, never resets it a second time.
class RuntimeReviewedSetup {
 constructor(scope,helpers){this.scope=scope;this.helpers=helpers;}
 async run({token,draft,provider,stream,report}){
  const s=this.scope,h=this.helpers,G=h.Globals;let stages={...(draft.stages||{})};
  const record=async(name,value=true)=>{stages[name]=value;await provider.stage(token,name,value);};
  const fields={...s.buildNewGameDefaults(draft.setting),...draft.fields};
  if(!stages.runtimeStarted){const cancellation=await h.cancelRuntime();G.reloadConfigAndDefs({gameConfigOverrideYaml:'',needBarSentenceValidationMode:'throw'});await provider.prepare(token);const calendar=await h.resolveCalendar(draft.setting);const day=G.getCalendarDayIndex({monthNumber:fields.startMonth,dayOfMonth:fields.startDay,calendarDefinition:calendar});h.reset({runtimeCancellation:cancellation,activeSetting:draft.setting,calendarDefinition:calendar,startingDayIndex:day,resolvedStartTime:fields.startTime});await record('runtimeStarted',{generation:s.getRuntimeGenerationId()});}
  else{if(stages.runtimeStarted.generation!==s.getRuntimeGenerationId())throw new Error('Partial setup belongs to a different runtime; review reconciliation before resuming.');await provider.prepare(token,{resume:true});}
  const setting=s.getActiveSettingSnapshot(),settingDescription=s.describeSettingForPrompt(setting);
  if(!stages.skillsReady){const names=s.buildNewGameDefaults(setting).existingSkills||[];const skills=names.length?await s.generateSkillsByNames({skillNames:names,settingDescription}):[];s.skills.clear();for(const skill of skills){if(!skill?.name)throw new Error('Canonical skill generator returned an invalid skill.');s.skills.set(skill.name,skill);}s.Player.setAvailableSkills(s.skills);await record('skillsReady');}
  if(!stages.factionsReady){const defaults=s.buildNewGameDefaults(setting),count=defaults.factionCount??s.config?.factions?.count;if(!Number.isSafeInteger(count)||count<0)throw new Error('Reviewed setup faction count must be a nonnegative integer.');const drafts=defaults.factions||[];if(drafts.length>count)throw new Error('Reviewed faction drafts exceed the selected count.');const fixed=drafts.map(d=>s.Faction.fromJSON(d));const generated=count>fixed.length?await s.generateFactionsList({count:count-fixed.length,settingDescription}):[];const all=[...fixed,...generated];if(all.length!==count||new Set(all.map(f=>f.name.toLowerCase())).size!==all.length)throw new Error('Canonical factions do not match the reviewed finite count.');s.factions.clear();for(const f of all)s.factions.set(f.id,f);await record('factionsReady');}
  let player=stages.playerCreated?s.players.get(stages.playerCreated):null;
  if(stages.playerCreated&&!player)throw new Error('Partial setup protagonist is missing.');
  if(!player){player=h.protagonist.create(fields);s.players.set(player.id,player);h.activate(player);await provider.playerCreated(token,player);await record('playerCreated',player.id);}
  else h.activate(player);
  if(!stages.standingsReady){await s.generateInitialFactionStandings({player,factions:s.factions});await record('standingsReady');}
  let location=stages.locationReady?s.gameLocations.get(stages.locationReady.locationId):null,region=stages.locationReady?s.regions.get(stages.locationReady.regionId):null;
  if(stages.locationReady&&(!location||!region))throw new Error('Partial setup region/location disappeared.');
  if(!location){if(!stages.regionReady){const result=await s.generateRegionFromPrompt({setting:settingDescription,regionNotes:fields.startingLocation||setting.name,report});await record('regionReady',{regionId:result.region.id,entranceLocationId:result.region.entranceLocationId||result.entranceLocationId});}region=s.regions.get(stages.regionReady.regionId);if(!region)throw new Error('Canonical region is missing after generation.');location=s.gameLocations.get(stages.regionReady.entranceLocationId);if(!location)throw new Error('Canonical entrance is missing.');if(location.isStub){const expanded=await s.generateLocationFromPrompt({stubLocation:location});if(!expanded?.location)throw new Error('Canonical entrance expansion failed.');location=expanded.location;}G.recordPlayerArrivalVisitState(location,false);player.setLocation(location.id);G.syncWorldTimeToPlayer(player);await record('locationReady',{locationId:location.id,regionId:region.id});}
  if(!stages.discoveryReady){await h.discover(player,location);s.queueNpcAssetsForLocation(location);await record('discoveryReady');}
  await h.protagonist.initialize(player,location,region,{stages,record,standings:false});
  G.gameLoaded=true;
  const choice=await s.resolvePlayerAbilitySelectionState(player,{ensureOptionsForNext:true});
  const introDeferred=choice?.pending===true;
  if(introDeferred)h.setPendingIntro({source:'reviewed_draft',locationId:location.id,draftToken:token});
  else if(!stages.introWritten){await h.intro({locationOverride:location,locationId:location.id,stream});await record('introWritten');h.setPendingIntro(null);}
  await provider.complete(token,{player,introDeferred});
  return{success:true,message:'Reviewed game setup completed',player:player.toJSON(),startingLocation:location.toJSON(),region:region.toJSON(),pendingAbilitySelection:choice,introDeferred};
 }
}
module.exports=RuntimeReviewedSetup;
