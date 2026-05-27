package com.ssafy.backend.domain.onehandsign.repository;

import com.ssafy.backend.domain.onehandsign.document.OneHandSignDocument;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface OneHandSignRepository extends MongoRepository<OneHandSignDocument, String> {
}
