from __future__ import annotations

from models import CandidateProfileExtraction, EducationHistoryExtraction, WorkHistoryExtraction

from services.education_history_recovery import recover_education_history_from_text
from services.llm import LLMService
from services.work_history_recovery import recover_work_history_from_text


async def extract_candidate_profile(llm_service: LLMService, combined_text: str) -> CandidateProfileExtraction:
	profile = await llm_service.parse_candidate_cv(combined_text)

	if not profile.work_history:
		recovered_work_history = recover_work_history_from_text(combined_text)
		if recovered_work_history:
			profile.work_history = [WorkHistoryExtraction(**entry) for entry in recovered_work_history]
			first_entry = recovered_work_history[0]
			if not profile.current_employer and first_entry.get("employer"):
				profile.current_employer = first_entry["employer"]
			if not profile.current_position and first_entry.get("position"):
				profile.current_position = first_entry["position"]
			if not profile.experience:
				profile.experience = "\n".join(
					filter(
						None,
						(
							", ".join(filter(None, (entry.get("position"), entry.get("employer"))))
							for entry in recovered_work_history[:3]
						),
					),
				)

	if not profile.education_history:
		recovered_education_history = recover_education_history_from_text(combined_text)
		if recovered_education_history:
			profile.education_history = [EducationHistoryExtraction(**entry) for entry in recovered_education_history]

	return profile